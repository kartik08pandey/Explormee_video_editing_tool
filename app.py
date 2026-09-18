import os
import re
import json
import uuid
import shutil
import zipfile
import subprocess
import time
from datetime import timedelta
from flask import Flask, request, jsonify, render_template, send_file, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2 GB upload limit
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'outputs')
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

@app.after_request
def add_header(response):
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

ALLOWED_EXTENSIONS = {'mp4', 'mov', 'avi', 'mkv', 'webm', 'mpeg', 'mpg'}

# Create outputs directory if it doesn't exist
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def check_ffmpeg():
    """Verify that FFmpeg and FFprobe are installed and accessible."""
    try:
        subprocess.run(['ffmpeg', '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        subprocess.run(['ffprobe', '-version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False

def get_video_metadata(filepath):
    """Extract metadata using FFprobe."""
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json', 
        '-show_format', '-show_streams', filepath
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        data = json.loads(result.stdout)
        
        video_stream = next((s for s in data.get('streams', []) if s['codec_type'] == 'video'), None)
        audio_stream = next((s for s in data.get('streams', []) if s['codec_type'] == 'audio'), None)
        
        format_info = data.get('format', {})
        duration = float(format_info.get('duration', 0))
        size = int(format_info.get('size', 0))
        
        width = video_stream.get('width', 0) if video_stream else 0
        height = video_stream.get('height', 0) if video_stream else 0
        
        # Calculate FPS
        fps = 0
        if video_stream and 'r_frame_rate' in video_stream:
            num, den = map(int, video_stream['r_frame_rate'].split('/'))
            if den != 0:
                fps = round(num / den, 2)
                
        # Calculate formatted duration with milliseconds
        hours = int(duration // 3600)
        minutes = int((duration % 3600) // 60)
        secs = duration % 60
        duration_formatted = f"{hours:02d}:{minutes:02d}:{secs:06.3f}"
                
        return {
            'duration': duration,
            'duration_formatted': duration_formatted,
            'width': width,
            'height': height,
            'fps': fps,
            'size': size,
            'size_formatted': f"{size / (1024 * 1024):.2f} MB",
            'has_audio': audio_stream is not None,
            'has_video': video_stream is not None
        }
    except Exception as e:
        print(f"Metadata extraction error: {e}")
        return None

def parse_time_str(val):
    """Parse a single timestamp string (seconds, MM:SS, or HH:MM:SS) into a float of seconds."""
    val = val.strip()
    if not val:
        raise ValueError("Empty timestamp")
    if ':' in val:
        parts = val.split(':')
        if len(parts) == 3:
            h, m, s = map(float, parts)
            return h * 3600 + m * 60 + s
        elif len(parts) == 2:
            m, s = map(float, parts)
            return m * 60 + s
        else:
            raise ValueError(f"Invalid timestamp format: '{val}'")
    else:
        return float(val)

def format_timestamp(seconds):
    """Format seconds into HH:MM:SS.ss or MM:SS.ss."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:05.2f}"
    else:
        return f"{minutes:02d}:{secs:05.2f}"

def parse_clip_segments(duration_text):
    """Parse timestamp ranges (e.g., 00:10 - 00:25, 01:15 to 01:45) or single durations into clip segment dicts."""
    raw_lines = re.split(r'[,\n\r]+', duration_text)
    segments = []
    current_chain_start = 0.0

    for raw in raw_lines:
        line = raw.strip()
        if not line:
            continue

        # Check for range delimiters: ->, -, –, —, or "to"
        range_match = re.split(r'\s*(?:->|[-–—]|\bto\b)\s*', line, maxsplit=1, flags=re.IGNORECASE)

        if len(range_match) == 2 and range_match[0] and range_match[1]:
            try:
                start_sec = parse_time_str(range_match[0])
                end_sec = parse_time_str(range_match[1])
            except ValueError:
                raise ValueError(f"Invalid timestamp range: '{line}'")

            if start_sec < 0 or end_sec < 0:
                raise ValueError(f"Timestamps must be non-negative: '{line}'")
            if end_sec <= start_sec:
                raise ValueError(f"End time must be greater than start time: '{line}' ({end_sec}s <= {start_sec}s)")

            dur = end_sec - start_sec
            segments.append({
                'start': start_sec,
                'end': end_sec,
                'duration': dur,
                'start_formatted': format_timestamp(start_sec),
                'end_formatted': format_timestamp(end_sec),
                'range_label': f"{format_timestamp(start_sec)} → {format_timestamp(end_sec)}"
            })
            current_chain_start = end_sec
        else:
            # Fallback if a single number/duration is provided
            try:
                dur = parse_time_str(line)
            except ValueError:
                raise ValueError(f"Invalid timestamp format: '{line}'. Example range: '00:10 - 00:25'")
            if dur <= 0:
                raise ValueError(f"Duration must be greater than 0: '{line}'")
            start_sec = current_chain_start
            end_sec = start_sec + dur
            segments.append({
                'start': start_sec,
                'end': end_sec,
                'duration': dur,
                'start_formatted': format_timestamp(start_sec),
                'end_formatted': format_timestamp(end_sec),
                'range_label': f"{format_timestamp(start_sec)} → {format_timestamp(end_sec)}"
            })
            current_chain_start = end_sec

    return segments

@app.route('/')
def index():
    if not check_ffmpeg():
        return "<h1>Error: FFmpeg or FFprobe not found.</h1><p>Please install FFmpeg and ensure it is added to your system's PATH.</p>", 500
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file part'}), 400
    
    file = request.files['video']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
        
    if file and allowed_file(file.filename):
        # Generate isolated session ID
        session_id = str(uuid.uuid4())
        session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
        os.makedirs(session_dir, exist_ok=True)
        
        filename = secure_filename(file.filename)
        filepath = os.path.join(session_dir, filename)
        file.save(filepath)
        
        # Get metadata
        metadata = get_video_metadata(filepath)
        if not metadata:
            return jsonify({'error': 'Failed to read video metadata. Corrupt or unsupported file.'}), 400
            
        return jsonify({
            'message': 'Upload successful',
            'session_id': session_id,
            'filename': filename,
            'metadata': metadata
        })
    else:
        return jsonify({'error': 'Unsupported file format'}), 400

@app.route('/media/<session_id>/<filename>')
def serve_media(session_id, filename):
    session_id = secure_filename(session_id)
    filename = secure_filename(filename)
    directory = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    response = send_from_directory(directory, filename)
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/download/<session_id>/<filename>')
def download_file(session_id, filename):
    session_id = secure_filename(session_id)
    filename = secure_filename(filename)
    directory = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    response = send_from_directory(directory, filename, as_attachment=True)
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/download-zip/<session_id>')
def download_zip(session_id):
    session_id = secure_filename(session_id)
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404
        
    zip_filename = f"clips_{session_id[:8]}.zip"
    zip_path = os.path.join(session_dir, zip_filename)
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for f in os.listdir(session_dir):
            if f.startswith('clip_') and f.endswith('.mp4'):
                zipf.write(os.path.join(session_dir, f), arcname=f)
                
    return send_from_directory(session_dir, zip_filename, as_attachment=True)

@app.route('/split', methods=['POST'])
def split_video():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))
    duration_text = data.get('durations', '')
    
    try:
        segments = parse_clip_segments(duration_text)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
        
    if not segments:
        return jsonify({'error': 'No valid timestamps or ranges provided'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    input_path = os.path.join(session_dir, filename)
    
    if not os.path.exists(input_path):
        return jsonify({'error': 'Source file not found'}), 404
        
    output_files = []
    clip_details = []
    
    for i, seg in enumerate(segments):
        out_name = f"clip_{i+1:02d}.mp4"
        out_path = os.path.join(session_dir, out_name)
        
        # Using -preset veryfast to speed up re-encoding while maintaining precise cuts
        cmd = [
            'ffmpeg', '-y', 
            '-ss', str(seg['start']), 
            '-i', input_path, 
            '-t', str(seg['duration']), 
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
            '-c:a', 'aac', '-b:a', '192k',
            '-avoid_negative_ts', 'make_zero',
            out_path
        ]
        
        try:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            output_files.append(out_name)
            clip_details.append({
                'filename': out_name,
                'index': i + 1,
                'duration': seg['duration'],
                'duration_formatted': f"{seg['duration']:.2f}s",
                'start_time': seg['start'],
                'end_time': seg['end'],
                'start_formatted': seg['start_formatted'],
                'end_formatted': seg['end_formatted'],
                'range_label': seg['range_label']
            })
        except subprocess.CalledProcessError as e:
            return jsonify({'error': f"FFmpeg failed on clip {i+1} ({seg['range_label']}). Error snippet: {e.stderr.decode()[-200:]}"}), 500
            
    return jsonify({'message': 'Success', 'files': output_files, 'clip_details': clip_details})

@app.route('/merge', methods=['POST'])
def merge_clips():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    files = data.get('files', [])
    
    if len(files) < 2:
        return jsonify({'error': 'At least two clips are required to merge'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404
        
    # Validate all files exist
    secure_files = []
    for f in files:
        sf = secure_filename(f)
        if not os.path.exists(os.path.join(session_dir, sf)):
            return jsonify({'error': f'File {sf} not found in session'}), 404
        secure_files.append(sf)
        
    # Create concat list for FFmpeg
    concat_list_path = os.path.join(session_dir, 'concat_list.txt')
    with open(concat_list_path, 'w') as f:
        for sf in secure_files:
            f.write(f"file '{sf}'\n")
            
    out_name = f"merged_{int(time.time())}.mp4"
    out_path = os.path.join(session_dir, out_name)
    
    # Use concat demuxer which safely joins identical stream formats instantly without re-encoding
    cmd = [
        'ffmpeg', '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', concat_list_path,
        '-c', 'copy',
        out_path
    ]
    
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        meta = get_video_metadata(out_path)
        return jsonify({'message': 'Success', 'file': out_name, 'metadata': meta})
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f"Merging failed. Error: {e.stderr.decode()[-200:]}"}), 500

@app.route('/crop', methods=['POST'])
def crop_video():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))
    
    try:
        x = int(data.get('x', 0))
        y = int(data.get('y', 0))
        w = int(data.get('w', 1280))
        h = int(data.get('h', 720))
    except ValueError:
        return jsonify({'error': 'Crop dimensions must be numbers'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    input_path = os.path.join(session_dir, filename)
    
    if not os.path.exists(input_path):
        return jsonify({'error': 'Source file not found'}), 404
        
    out_name = "cropped_video.mp4"
    out_path = os.path.join(session_dir, out_name)
    
    cmd = [
        'ffmpeg', '-y', 
        '-i', input_path, 
        '-vf', f'crop={w}:{h}:{x}:{y}', 
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', 
        '-c:a', 'copy', 
        out_path
    ]
    
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return jsonify({'message': 'Success', 'file': out_name})
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f"Cropping failed. Verify dimensions are within video limits. Error: {e.stderr.decode()[-200:]}"}), 500

@app.route('/extract-audio', methods=['POST'])
def extract_audio():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))
    fmt = data.get('format', 'mp3').lower()
    bitrate = data.get('bitrate', '192k')
    sample_rate = data.get('sample_rate', '44100')
    
    allowed_formats = {'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'}
    if fmt not in allowed_formats:
        return jsonify({'error': 'Unsupported audio format'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    input_path = os.path.join(session_dir, filename)
    
    if not os.path.exists(input_path):
        return jsonify({'error': 'Source file not found'}), 404
        
    # Check if video has audio stream
    metadata = get_video_metadata(input_path)
    if not metadata or not metadata.get('has_audio'):
        return jsonify({'error': 'No audio stream found in this video'}), 400
        
    out_name = f"extracted_audio.{fmt}"
    out_path = os.path.join(session_dir, out_name)
    
    cmd = ['ffmpeg', '-y', '-i', input_path, '-vn']
    
    # Codec specifics
    if fmt == 'mp3':
        cmd.extend(['-c:a', 'libmp3lame', '-b:a', bitrate, '-ar', sample_rate])
    elif fmt == 'wav':
        cmd.extend(['-c:a', 'pcm_s16le', '-ar', sample_rate])
    elif fmt == 'aac':
        cmd.extend(['-c:a', 'aac', '-b:a', bitrate, '-ar', sample_rate])
    elif fmt == 'm4a':
        cmd.extend(['-c:a', 'aac', '-b:a', bitrate, '-ar', sample_rate])
    elif fmt == 'flac':
        cmd.extend(['-c:a', 'flac', '-ar', sample_rate])
    elif fmt == 'ogg':
        cmd.extend(['-c:a', 'libvorbis', '-b:a', bitrate, '-ar', sample_rate])
        
    cmd.append(out_path)
    
    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return jsonify({'message': 'Success', 'file': out_name})
    except subprocess.CalledProcessError as e:
        return jsonify({'error': f"Audio extraction failed. Error: {e.stderr.decode()[-200:]}"}), 500

if __name__ == '__main__':
    print("\n--- Starting Local Video Editor ---")
    if not check_ffmpeg():
        print("WARNING: FFmpeg or FFprobe was not found on your system PATH.")
        print("The application will run, but processing features will fail.")
        print("Please install FFmpeg: https://ffmpeg.org/download.html")
    else:
        print("FFmpeg verification passed.")
        
    print(f"Output directory initialized at: {app.config['UPLOAD_FOLDER']}")
    print("Open http://localhost:5000 in your web browser.")
    print("-----------------------------------\n")
    
    app.run(host='0.0.0.0', port=5000, debug=False)