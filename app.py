import os
import re
import json
import uuid
import shutil
import zipfile
import subprocess
import time
import threading
import concurrent.futures
from datetime import timedelta
from flask import Flask, request, jsonify, render_template, send_file, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2 GB upload limit
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'outputs')
app.config['TEMPLATES_AUTO_RELOAD'] = True
app.jinja_env.auto_reload = True

# --- Background Task Manager for FFmpeg Operations ---
# max_workers=2 ensures system stability and prevents CPU choking while allowing parallel workflows
TASK_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=2, thread_name_prefix="ffmpeg_worker")
TASKS = {}
TASKS_LOCK = threading.Lock()

def create_task(task_type, target_func, *args, **kwargs):
    """Register and submit a long-running job to the background thread pool."""
    task_id = str(uuid.uuid4())
    now = time.time()
    with TASKS_LOCK:
        # Prune tasks older than 30 minutes to prevent memory leaks
        stale_ids = [tid for tid, t in TASKS.items() if now - t.get('created_at', now) > 1800]
        for tid in stale_ids:
            del TASKS[tid]
            
        TASKS[task_id] = {
            'task_id': task_id,
            'type': task_type,
            'status': 'queued',
            'progress': 0,
            'message': 'Queued for processing...',
            'result': None,
            'error': None,
            'created_at': now,
            'updated_at': now,
            '_proc': None
        }

    def runner():
        with TASKS_LOCK:
            if TASKS.get(task_id, {}).get('status') == 'cancelled':
                return
            TASKS[task_id]['status'] = 'processing'
            TASKS[task_id]['message'] = 'Processing started...'
            TASKS[task_id]['updated_at'] = time.time()

        def set_progress(pct, msg=None):
            with TASKS_LOCK:
                if task_id in TASKS and TASKS[task_id]['status'] != 'cancelled':
                    TASKS[task_id]['progress'] = max(0, min(100, round(pct)))
                    if msg:
                        TASKS[task_id]['message'] = msg
                    TASKS[task_id]['updated_at'] = time.time()

        def register_proc(proc):
            with TASKS_LOCK:
                if task_id in TASKS:
                    TASKS[task_id]['_proc'] = proc

        try:
            result = target_func(set_progress=set_progress, register_proc=register_proc, *args, **kwargs)
            with TASKS_LOCK:
                if TASKS.get(task_id, {}).get('status') != 'cancelled':
                    TASKS[task_id]['status'] = 'completed'
                    TASKS[task_id]['progress'] = 100
                    TASKS[task_id]['message'] = 'Completed successfully'
                    TASKS[task_id]['result'] = result
                    TASKS[task_id]['_proc'] = None
                    TASKS[task_id]['updated_at'] = time.time()
        except Exception as e:
            with TASKS_LOCK:
                if TASKS.get(task_id, {}).get('status') != 'cancelled':
                    TASKS[task_id]['status'] = 'failed'
                    TASKS[task_id]['error'] = str(e)
                    TASKS[task_id]['message'] = f"Failed: {str(e)}"
                    TASKS[task_id]['_proc'] = None
                    TASKS[task_id]['updated_at'] = time.time()

    TASK_EXECUTOR.submit(runner)
    return task_id

def get_task(task_id):
    """Retrieve task state dictionary in a thread-safe manner."""
    with TASKS_LOCK:
        task = TASKS.get(task_id)
        if not task:
            return None
        return {
            'task_id': task['task_id'],
            'type': task['type'],
            'status': task['status'],
            'progress': task['progress'],
            'message': task['message'],
            'result': task['result'],
            'error': task['error'],
            'created_at': task['created_at'],
            'updated_at': task['updated_at']
        }

def cancel_task(task_id):
    """Cancel a running task and terminate child FFmpeg process if active."""
    with TASKS_LOCK:
        task = TASKS.get(task_id)
        if not task:
            return False, "Task not found"
        task['status'] = 'cancelled'
        task['message'] = 'Cancelled by user'
        task['updated_at'] = time.time()
        proc = task.get('_proc')
        if proc:
            try:
                proc.kill()
            except Exception:
                pass
            task['_proc'] = None
        return True, "Task cancelled"

def run_ffmpeg_command(cmd, total_duration=None, set_progress=None, register_proc=None):
    """
    Executes an FFmpeg command using subprocess.Popen with optional real-time progress parsing.
    Drains stderr concurrently to prevent pipe buffer deadlock and registers process handle for cancellation.
    """
    use_progress_pipe = bool(total_duration and total_duration > 0 and set_progress)
    actual_cmd = list(cmd)
    
    if use_progress_pipe:
        out_file = actual_cmd.pop()
        actual_cmd.extend(['-progress', 'pipe:1', '-nostats', out_file])

    proc = subprocess.Popen(
        actual_cmd,
        stdout=subprocess.PIPE if use_progress_pipe else subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        encoding='utf-8',
        errors='replace'
    )
    
    if register_proc:
        register_proc(proc)

    stderr_lines = []
    def drain_stderr():
        try:
            for line in proc.stderr:
                stderr_lines.append(line)
                if len(stderr_lines) > 60:
                    stderr_lines.pop(0)
        except Exception:
            pass

    err_thread = threading.Thread(target=drain_stderr, daemon=True)
    err_thread.start()

    if use_progress_pipe:
        while True:
            line = proc.stdout.readline()
            if not line and proc.poll() is not None:
                break
            if not line:
                continue
            line = line.strip()
            if line.startswith('out_time='):
                try:
                    time_val = line.split('=', 1)[1].strip()
                    cur_secs = parse_time_str(time_val)
                    pct = min(99, max(0, (cur_secs / total_duration) * 100))
                    if set_progress:
                        set_progress(pct, f"Encoding... {int(pct)}%")
                except Exception:
                    pass
            elif line == 'progress=end':
                if set_progress:
                    set_progress(100, "Finalizing output...")

    proc.wait()
    err_thread.join(timeout=1.0)

    if proc.returncode != 0 and proc.returncode != -9 and proc.returncode != 1:
        err_msg = "".join(stderr_lines[-20:]) if stderr_lines else "Unknown FFmpeg error"
        raise RuntimeError(f"FFmpeg error (code {proc.returncode}): {err_msg}")

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
            end_part = range_match[1].strip()
            custom_name = None
            if '|' in end_part:
                t_sub, n_sub = end_part.split('|', 1)
                end_part = t_sub.strip()
                custom_name = n_sub.strip()
            elif ' ' in end_part:
                tokens = end_part.split(None, 1)
                try:
                    _ = parse_time_str(tokens[0])
                    end_part = tokens[0]
                    custom_name = tokens[1].strip()
                except ValueError:
                    pass

            try:
                start_sec = parse_time_str(range_match[0])
                end_sec = parse_time_str(end_part)
            except ValueError:
                raise ValueError(f"Invalid timestamp range: '{line}'")

            if start_sec < 0 or end_sec < 0:
                raise ValueError(f"Timestamps must be non-negative: '{line}'")
            if end_sec <= start_sec:
                raise ValueError(f"End time must be greater than start time: '{line}' ({end_sec}s <= {start_sec}s)")

            dur = end_sec - start_sec
            seg_dict = {
                'start': start_sec,
                'end': end_sec,
                'duration': dur,
                'start_formatted': format_timestamp(start_sec),
                'end_formatted': format_timestamp(end_sec),
                'range_label': f"{format_timestamp(start_sec)} -> {format_timestamp(end_sec)}"
            }
            if custom_name:
                seg_dict['name'] = custom_name
            segments.append(seg_dict)
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
                'range_label': f"{format_timestamp(start_sec)} -> {format_timestamp(end_sec)}"
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

# --- Background Task Endpoints ---

@app.route('/tasks/<task_id>', methods=['GET'])
def get_task_status(task_id):
    """Poll task progress and status."""
    task = get_task(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(task)

@app.route('/tasks/<task_id>/cancel', methods=['POST'])
def cancel_task_route(task_id):
    """Cancel an active task and abort any running FFmpeg process."""
    success, msg = cancel_task(task_id)
    if not success:
        return jsonify({'error': msg}), 404
    return jsonify({'message': msg})

def _do_split(session_dir, input_path, segments, set_progress=None, register_proc=None):
    output_files = []
    clip_details = []
    total_segs = len(segments)
    
    for i, seg in enumerate(segments):
        if set_progress:
            pct = (i / total_segs) * 100
            set_progress(pct, f"Generating clip {i+1} of {total_segs}...")
            
        if seg.get('name'):
            clean_name = secure_filename(seg['name'])
            if clean_name:
                if not clean_name.lower().endswith('.mp4'):
                    clean_name += '.mp4'
                out_name = clean_name
            else:
                out_name = f"clip_{i+1:02d}.mp4"
        else:
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
            run_ffmpeg_command(cmd, total_duration=None, set_progress=None, register_proc=register_proc)
        except Exception as e:
            raise RuntimeError(f"FFmpeg failed on clip {i+1} ({seg['range_label']}): {e}")
            
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
        
    if set_progress:
        set_progress(100, f"Generated {total_segs} clip(s) successfully!")
        
    return {'files': output_files, 'clip_details': clip_details}

@app.route('/split', methods=['POST'])
def split_video():
    data = request.json or {}
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
        
    task_id = create_task('split', _do_split, session_dir, input_path, segments)
    return jsonify({'task_id': task_id, 'status': 'queued', 'message': 'Splitting clips in background...'}), 202

@app.route('/rename-clip', methods=['POST'])
def rename_clip():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    old_name = secure_filename(data.get('old_name', ''))
    raw_new_name = data.get('new_name', '').strip()
    
    if not raw_new_name:
        return jsonify({'error': 'Clip name cannot be empty'}), 400
        
    if not raw_new_name.lower().endswith('.mp4'):
        raw_new_name += '.mp4'
        
    new_name = secure_filename(raw_new_name)
    if not new_name or new_name == '.mp4':
        return jsonify({'error': 'Invalid file name'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404
        
    old_path = os.path.join(session_dir, old_name)
    new_path = os.path.join(session_dir, new_name)
    
    if not os.path.exists(old_path):
        return jsonify({'error': f'Source clip "{old_name}" not found'}), 404
        
    if old_name != new_name and os.path.exists(new_path):
        return jsonify({'error': f'A clip named "{new_name}" already exists'}), 400
        
    try:
        os.rename(old_path, new_path)
        return jsonify({'message': 'Success', 'old_name': old_name, 'new_name': new_name})
    except Exception as e:
        return jsonify({'error': f'Renaming failed: {str(e)}'}), 500

@app.route('/delete-clip', methods=['POST'])
def delete_clip():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))

    if not session_id or not filename:
        return jsonify({'error': 'Missing session_id or filename'}), 400

    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404

    clip_path = os.path.join(session_dir, filename)
    if os.path.exists(clip_path):
        try:
            os.remove(clip_path)
        except Exception as e:
            return jsonify({'error': f'Failed to delete file: {str(e)}'}), 500

    return jsonify({'message': 'Success', 'filename': filename})

@app.route('/duplicate-clip', methods=['POST'])
def duplicate_clip():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))

    if not session_id or not filename:
        return jsonify({'error': 'Missing session_id or filename'}), 400

    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404

    src_path = os.path.join(session_dir, filename)
    if not os.path.exists(src_path):
        return jsonify({'error': f'Source clip "{filename}" not found'}), 404

    # Generate a unique copy filename
    base, ext = os.path.splitext(filename)
    match = re.match(r'^(.*?)(?:_copy(?:_(\d+))?)?$', base)
    clean_base = match.group(1) if match and match.group(1) else base

    new_filename = f"{clean_base}_copy{ext}"
    counter = 1
    while os.path.exists(os.path.join(session_dir, new_filename)):
        counter += 1
        new_filename = f"{clean_base}_copy_{counter}{ext}"

    dst_path = os.path.join(session_dir, new_filename)
    try:
        shutil.copy2(src_path, dst_path)
    except Exception as e:
        return jsonify({'error': f'Failed to duplicate file: {str(e)}'}), 500

    meta = get_video_metadata(dst_path)
    return jsonify({
        'message': 'Success',
        'original_filename': filename,
        'new_filename': new_filename,
        'metadata': meta
    })

@app.route('/trim-clip', methods=['POST'])
def trim_clip():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))
    source_filename = secure_filename(data.get('source_filename', ''))

    try:
        start_time = float(data.get('start_time', 0.0))
        end_time = float(data.get('end_time', 0.0))
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid start_time or end_time'}), 400

    if start_time < 0:
        return jsonify({'error': 'Start time must be non-negative'}), 400
    if end_time <= start_time:
        return jsonify({'error': 'End time must be greater than start time'}), 400
    if (end_time - start_time) < 0.5:
        return jsonify({'error': 'Clip duration must be at least 0.5 seconds'}), 400

    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404

    clip_path = os.path.join(session_dir, filename)
    source_path = os.path.join(session_dir, source_filename)

    if not os.path.exists(source_path):
        return jsonify({'error': f'Original source video "{source_filename}" not found'}), 404

    try:
        source_meta = get_video_metadata(source_path)
        if source_meta and 'duration' in source_meta:
            source_dur = source_meta['duration']
            if end_time > source_dur + 0.05:
                end_time = source_dur
    except Exception:
        pass

    duration = end_time - start_time
    if duration < 0.5:
        return jsonify({'error': 'Clip duration must be at least 0.5 seconds'}), 400

    temp_filename = f"trim_tmp_{uuid.uuid4().hex[:8]}.mp4"
    temp_path = os.path.join(session_dir, temp_filename)

    cmd = [
        'ffmpeg', '-y',
        '-ss', str(start_time),
        '-i', source_path,
        '-t', str(duration),
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-c:a', 'aac', '-b:a', '192k',
        '-avoid_negative_ts', 'make_zero',
        '-pix_fmt', 'yuv420p',
        temp_path
    ]

    try:
        subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    except subprocess.CalledProcessError as e:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass
        return jsonify({'error': f"FFmpeg trimming failed: {e.stderr.decode()[-200:]}"}), 500

    try:
        os.replace(temp_path, clip_path)
    except Exception as e:
        try:
            time.sleep(0.1)
            os.replace(temp_path, clip_path)
        except Exception as e2:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass
            return jsonify({'error': f'Failed to update clip file: {str(e2)}'}), 500

    dur = round(duration, 2)
    start_formatted = format_timestamp(start_time)
    end_formatted = format_timestamp(end_time)
    range_label = f"{start_formatted} -> {end_formatted}"

    return jsonify({
        'message': 'Success',
        'filename': filename,
        'start_time': round(start_time, 2),
        'end_time': round(end_time, 2),
        'duration': dur,
        'duration_formatted': f"{dur:.2f}s",
        'start_formatted': start_formatted,
        'end_formatted': end_formatted,
        'range_label': range_label
    })

@app.route('/split-clip', methods=['POST'])
def split_clip():
    data = request.json
    session_id = secure_filename(data.get('session_id', ''))
    filename = secure_filename(data.get('filename', ''))
    source_filename = secure_filename(data.get('source_filename', ''))
    
    if not session_id or not filename:
        return jsonify({'error': 'Missing session_id or filename'}), 400

    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404

    clip_path = os.path.join(session_dir, filename)
    if not os.path.exists(clip_path):
        return jsonify({'error': f'Clip "{filename}" not found'}), 404

    clip_meta = get_video_metadata(clip_path)
    clip_dur = clip_meta.get('duration', 0.0) if clip_meta else 0.0
    if clip_dur <= 0:
        return jsonify({'error': 'Could not determine clip duration'}), 400

    try:
        start_time = float(data.get('start_time', 0.0))
        end_time = float(data.get('end_time', 0.0))
    except (ValueError, TypeError):
        start_time = 0.0
        end_time = clip_dur

    raw_points = data.get('split_points', [])
    if not raw_points and 'split_time' in data:
        raw_points = [data.get('split_time')]

    parsed_points = []
    for pt in raw_points:
        try:
            val = float(pt)
            if val > 0:
                parsed_points.append(round(val, 3))
        except (ValueError, TypeError):
            pass

    parsed_points = sorted(list(set(parsed_points)))

    MIN_SLICE = 0.35
    valid_points = []
    last_pt = 0.0
    for pt in parsed_points:
        if (pt - last_pt) >= MIN_SLICE and (clip_dur - pt) >= MIN_SLICE:
            valid_points.append(pt)
            last_pt = pt

    if len(valid_points) == 0:
        return jsonify({'error': f'No valid split points. Each segment must be at least {MIN_SLICE}s.'}), 400

    # Boundaries: [0, p1, p2, ..., clip_dur]
    boundaries = [0.0] + valid_points + [clip_dur]

    source_path = os.path.join(session_dir, source_filename) if source_filename else None
    has_valid_source = source_path and os.path.exists(source_path)

    base, ext = os.path.splitext(filename)
    match = re.match(r'^(.*?)(?:_part(\d+))?$', base)
    clean_base = match.group(1) if match and match.group(1) else base
    part_counter = int(match.group(2)) + 1 if match and match.group(2) else 2

    # Plan intervals
    plan = []
    for i in range(len(boundaries) - 1):
        seg_start = boundaries[i]
        seg_end = boundaries[i + 1]
        seg_dur = round(seg_end - seg_start, 3)

        if i == 0:
            target_fn = filename
        else:
            cand = f"{clean_base}_part{part_counter}{ext}"
            while os.path.exists(os.path.join(session_dir, cand)) or any(p['filename'] == cand for p in plan):
                part_counter += 1
                cand = f"{clean_base}_part{part_counter}{ext}"
            target_fn = cand
            part_counter += 1

        temp_fn = f"split_tmp_{uuid.uuid4().hex[:8]}.mp4"
        temp_path = os.path.join(session_dir, temp_fn)

        plan.append({
            'index': i,
            'filename': target_fn,
            'temp_path': temp_path,
            'final_path': os.path.join(session_dir, target_fn),
            'seg_start': seg_start,
            'seg_end': seg_end,
            'duration': seg_dur
        })

    # Execute FFmpeg encoding for each slice
    created_temps = []
    try:
        for item in plan:
            temp_p = item['temp_path']
            created_temps.append(temp_p)
            dur = str(item['duration'])

            if has_valid_source and end_time > start_time:
                src_seek = str(round(start_time + item['seg_start'], 3))
                cmd = [
                    'ffmpeg', '-y',
                    '-ss', src_seek,
                    '-i', source_path,
                    '-t', dur,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
                    '-c:a', 'aac', '-b:a', '192k',
                    '-avoid_negative_ts', 'make_zero',
                    '-pix_fmt', 'yuv420p',
                    temp_p
                ]
            else:
                clip_seek = str(round(item['seg_start'], 3))
                cmd = [
                    'ffmpeg', '-y',
                    '-ss', clip_seek,
                    '-i', clip_path,
                    '-t', dur,
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
                    '-c:a', 'aac', '-b:a', '192k',
                    '-avoid_negative_ts', 'make_zero',
                    '-pix_fmt', 'yuv420p',
                    temp_p
                ]

            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)

    except subprocess.CalledProcessError as e:
        for p in created_temps:
            if os.path.exists(p):
                try: os.remove(p)
                except OSError: pass
        return jsonify({'error': f"FFmpeg split failed: {e.stderr.decode()[-200:]}"}), 500

    # Atomic move temporary files into final paths
    for item in plan:
        target = item['final_path']
        try:
            os.replace(item['temp_path'], target)
        except Exception:
            time.sleep(0.1)
            os.replace(item['temp_path'], target)

    # Collect result metadata
    parts = []
    for item in plan:
        meta = get_video_metadata(item['final_path']) or {}
        actual_dur = round(meta.get('duration', item['duration']), 2)
        abs_start = round(start_time + item['seg_start'], 2)
        abs_end = round(start_time + item['seg_end'], 2)

        parts.append({
            'filename': item['filename'],
            'duration': actual_dur,
            'duration_formatted': f"{actual_dur:.2f}s",
            'start_time': abs_start,
            'end_time': abs_end,
            'start_formatted': format_timestamp(abs_start),
            'end_formatted': format_timestamp(abs_end),
            'range_label': f"{format_timestamp(abs_start)} -> {format_timestamp(abs_end)}"
        })

    return jsonify({
        'message': f"Split into {len(parts)} clips successfully",
        'parts': parts,
        'part1': parts[0],
        'part2': parts[1] if len(parts) > 1 else parts[0]
    })

def _do_merge(session_dir, concat_list_path, out_path, out_name, mode, total_duration, set_progress=None, register_proc=None):
    if set_progress:
        set_progress(5, "Starting merge process...")

    if mode == 'merge_crop':
        # 1. Scale/crop video to 1920x540
        # 2. Cut in middle into two equal 960x540 halves: Left (x=0..960), Right (x=960..1920)
        # 3. Stack vertically: Right half on top, Left half on bottom -> 960x1080
        # 4. Scale to 1080 width (1080x1216) and pad to 1080x1920 (standard 9:16) with dark top and bottom padding
        filter_complex = (
            "[0:v]scale=w=1920:h=540:force_original_aspect_ratio=increase,"
            "crop=1920:540,split=2[left_full][right_full];"
            "[left_full]crop=960:540:0:0[left];"
            "[right_full]crop=960:540:960:0[right];"
            "[right][left]vstack=inputs=2[stacked];"
            "[stacked]scale=1080:1216:flags=lanczos,pad=1080:1920:0:352:color=black,setsar=1[outv]"
        )
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_list_path,
            '-filter_complex', filter_complex,
            '-map', '[outv]',
            '-map', '0:a?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            out_path
        ]
    else:
        # Only Merge: Concatenate sequentially preserving original dimensions & aspect ratio
        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', concat_list_path,
            '-map', '0:v',
            '-map', '0:a?',
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
            '-pix_fmt', 'yuv420p',
            '-c:a', 'aac', '-b:a', '192k',
            out_path
        ]

    try:
        run_ffmpeg_command(cmd, total_duration=total_duration, set_progress=set_progress, register_proc=register_proc)
        meta = get_video_metadata(out_path)
        return {'file': out_name, 'mode': mode, 'metadata': meta}
    except Exception as e:
        action_name = "Merging & Cropping" if mode == 'merge_crop' else "Merging"
        raise RuntimeError(f"{action_name} failed: {e}")

@app.route('/merge', methods=['POST'])
def merge_clips():
    data = request.json or {}
    session_id = secure_filename(data.get('session_id', ''))
    files = data.get('files', [])
    mode = data.get('mode', 'merge')  # 'merge' (Only Merge) or 'merge_crop' (Merge + Crop)
    
    if len(files) < 1:
        return jsonify({'error': 'At least one clip is required to merge'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    if not os.path.exists(session_dir):
        return jsonify({'error': 'Session not found'}), 404
        
    # Validate all files exist and compute total duration for progress calculation
    secure_files = []
    total_duration = 0.0
    for f in files:
        sf = secure_filename(f)
        f_path = os.path.join(session_dir, sf)
        if not os.path.exists(f_path):
            return jsonify({'error': f'File {sf} not found in session'}), 404
        secure_files.append(sf)
        m = get_video_metadata(f_path)
        if m and m.get('duration'):
            total_duration += m['duration']
        
    # Create concat list for FFmpeg
    concat_list_path = os.path.join(session_dir, 'concat_list.txt')
    with open(concat_list_path, 'w', encoding='utf-8') as f:
        for sf in secure_files:
            f.write(f"file '{sf}'\n")
            
    timestamp = int(time.time())
    if mode == 'merge_crop':
        out_name = f"merged_cropped_{timestamp}.mp4"
    else:
        out_name = f"merged_{timestamp}.mp4"
    out_path = os.path.join(session_dir, out_name)
    
    task_id = create_task('merge', _do_merge, session_dir, concat_list_path, out_path, out_name, mode, total_duration)
    return jsonify({'task_id': task_id, 'status': 'queued', 'message': 'Merge task queued in background...'}), 202

def _do_crop(session_dir, input_path, out_path, out_name, x, y, w, h, duration, set_progress=None, register_proc=None):
    cmd = [
        'ffmpeg', '-y', 
        '-i', input_path, 
        '-vf', f'crop={w}:{h}:{x}:{y}', 
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', 
        '-c:a', 'copy', 
        out_path
    ]
    try:
        run_ffmpeg_command(cmd, total_duration=duration, set_progress=set_progress, register_proc=register_proc)
        return {'file': out_name}
    except Exception as e:
        raise RuntimeError(f"Cropping failed: {e}")

@app.route('/crop', methods=['POST'])
def crop_video():
    data = request.json or {}
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
    
    meta = get_video_metadata(input_path)
    duration = meta.get('duration') if meta else None
    
    task_id = create_task('crop', _do_crop, session_dir, input_path, out_path, out_name, x, y, w, h, duration)
    return jsonify({'task_id': task_id, 'status': 'queued', 'message': 'Crop task queued in background...'}), 202

def _do_extract_audio(session_dir, input_path, out_path, out_name, cmd, duration, set_progress=None, register_proc=None):
    try:
        run_ffmpeg_command(cmd, total_duration=duration, set_progress=set_progress, register_proc=register_proc)
        return {'file': out_name}
    except Exception as e:
        raise RuntimeError(f"Audio extraction failed: {e}")

@app.route('/extract-audio', methods=['POST'])
def extract_audio():
    data = request.json or {}
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
    
    duration = metadata.get('duration') if metadata else None
    task_id = create_task('extract-audio', _do_extract_audio, session_dir, input_path, out_path, out_name, cmd, duration)
    return jsonify({'task_id': task_id, 'status': 'queued', 'message': 'Audio extraction task queued in background...'}), 202

if __name__ == '__main__':
    print("\n--- Starting Local Video Editor ---")
    if not check_ffmpeg():
        print("WARNING: FFmpeg or FFprobe was not found on your system PATH.")
        print("The application will run, but processing features will fail.")
        print("Please install FFmpeg: https://ffmpeg.org/download.html")
    else:
        print("FFmpeg verification passed.")
        
    print(f"Output directory initialized at: {app.config['UPLOAD_FOLDER']}")
    port = int(os.environ.get('PORT', 5050))
    print(f"Server running at: http://127.0.0.1:{port}")
    print(f"Open http://127.0.0.1:{port} in your web browser.")
    print("-----------------------------------\n")
    
    app.run(host='0.0.0.0', port=port, debug=True)