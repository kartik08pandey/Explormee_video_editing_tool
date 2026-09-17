import os
import re
import json
import uuid
import shutil
import zipfile
import subprocess
from datetime import timedelta
from flask import Flask, request, jsonify, render_template_string, send_file, send_from_directory
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024 * 1024  # 2 GB upload limit
app.config['UPLOAD_FOLDER'] = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'outputs')

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

def parse_durations(duration_text):
    """Parse a list of durations (seconds or HH:MM:SS) into a list of floats."""
    parts = re.split(r'[,\n\r]+', duration_text)
    seconds_list = []
    for p in parts:
        p = p.strip()
        if not p:
            continue
        try:
            if ':' in p:
                time_parts = p.split(':')
                if len(time_parts) == 3:
                    h, m, s = map(float, time_parts)
                    seconds_list.append(h * 3600 + m * 60 + s)
                elif len(time_parts) == 2:
                    m, s = map(float, time_parts)
                    seconds_list.append(m * 60 + s)
            else:
                seconds_list.append(float(p))
        except ValueError:
            raise ValueError(f"Invalid duration format: '{p}'")
    return seconds_list

HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Local Video Editor</title>
    <style>
        :root {
            --bg-color: #f4f4f9;
            --surface-color: #ffffff;
            --text-primary: #1e293b;
            --text-secondary: #64748b;
            --accent-color: #3b82f6;
            --accent-hover: #2563eb;
            --border-color: #e2e8f0;
            --error-color: #ef4444;
            --success-color: #10b981;
            --radius-lg: 12px;
            --radius-md: 8px;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.1);
            --shadow-md: 0 4px 6px -1px rgba(0,0,0,0.1);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: var(--bg-color); color: var(--text-primary); line-height: 1.5; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; display: grid; grid-template-columns: 1fr; gap: 20px; }
        @media (min-width: 900px) { .container { grid-template-columns: 350px 1fr; } }
        
        .card { background: var(--surface-color); border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-sm); border: 1px solid var(--border-color); margin-bottom: 20px; }
        .card-title { font-size: 1.25rem; font-weight: 600; margin-bottom: 16px; color: var(--text-primary); display: flex; align-items: center; gap: 8px; }
        
        /* Upload Area */
        .upload-area { border: 2px dashed var(--border-color); border-radius: var(--radius-md); padding: 40px 20px; text-align: center; cursor: pointer; transition: all 0.2s; background: #f8fafc; }
        .upload-area:hover { border-color: var(--accent-color); background: #f1f5f9; }
        .upload-area.dragover { border-color: var(--accent-color); background: #eff6ff; }
        .upload-area input[type="file"] { display: none; }
        
        /* Typography & Forms */
        label { display: block; font-size: 0.875rem; font-weight: 500; margin-bottom: 6px; color: var(--text-secondary); }
        input[type="text"], input[type="number"], textarea, select { width: 100%; padding: 10px 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); font-family: inherit; font-size: 0.9rem; margin-bottom: 16px; transition: border-color 0.2s; }
        input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent-color); }
        textarea { resize: vertical; min-height: 80px; }
        
        /* Buttons */
        .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; background: var(--accent-color); color: white; border: none; padding: 10px 16px; border-radius: var(--radius-md); font-size: 0.9rem; font-weight: 500; cursor: pointer; transition: background 0.2s; width: 100%; }
        .btn:hover { background: var(--accent-hover); }
        .btn:disabled { background: var(--text-secondary); cursor: not-allowed; opacity: 0.7; }
        .btn-outline { background: transparent; border: 1px solid var(--border-color); color: var(--text-primary); }
        .btn-outline:hover { background: #f1f5f9; }
        .btn-success { background: var(--success-color); }
        .btn-success:hover { background: #059669; }
        
        /* Video & Grid */
        .video-container { position: relative; width: 100%; border-radius: var(--radius-md); overflow: hidden; background: #000; aspect-ratio: 16/9; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; user-select: none; }
        video { width: 100%; height: 100%; object-fit: contain; }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        
        /* Crop Editor Overlay */
        #cropEditor {
            position: absolute;
            display: none;
            overflow: hidden;
            pointer-events: none; /* Let clicks pass to video if outside crop box */
            z-index: 10;
        }
        
        #cropBox {
            position: absolute;
            border: 2px dashed rgba(255, 255, 255, 0.9);
            box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.65); /* Dims the outside area */
            cursor: move;
            pointer-events: auto; /* Catch events for drag/resize */
            box-sizing: border-box;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .crop-handle {
            position: absolute;
            width: 14px;
            height: 14px;
            background: var(--accent-color);
            border: 2px solid white;
            border-radius: 50%;
            z-index: 11;
        }
        /* Handle Positioning */
        .handle-tl { top: -7px; left: -7px; cursor: nwse-resize; }
        .handle-tc { top: -7px; left: calc(50% - 7px); cursor: ns-resize; }
        .handle-tr { top: -7px; right: -7px; cursor: nesw-resize; }
        .handle-ml { top: calc(50% - 7px); left: -7px; cursor: ew-resize; }
        .handle-mr { top: calc(50% - 7px); right: -7px; cursor: ew-resize; }
        .handle-bl { bottom: -7px; left: -7px; cursor: nesw-resize; }
        .handle-bc { bottom: -7px; left: calc(50% - 7px); cursor: ns-resize; }
        .handle-br { bottom: -7px; right: -7px; cursor: nwse-resize; }
        
        .crop-info-badge {
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.75rem;
            font-family: monospace;
            pointer-events: none;
        }

        /* Video Time Overlay */
        #videoTimeOverlay {
            position: absolute;
            top: 12px;
            left: 12px;
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 0.875rem;
            font-family: monospace;
            pointer-events: none;
            z-index: 20;
            display: none; /* hidden until upload */
            text-shadow: 0px 1px 2px rgba(0,0,0,0.8);
        }

        /* Metadata Table */
        .meta-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; margin-bottom: 16px; }
        .meta-table th, .meta-table td { padding: 8px 0; border-bottom: 1px solid var(--border-color); text-align: left; }
        .meta-table th { color: var(--text-secondary); font-weight: 500; width: 40%; }
        
        /* Status & Outputs */
        .status-box { padding: 12px; border-radius: var(--radius-md); font-size: 0.875rem; margin-bottom: 16px; display: none; }
        .status-info { background: #eff6ff; color: #1e3a8a; border: 1px solid #bfdbfe; display: block; }
        .status-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; display: block; }
        .status-success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; display: block; }
        
        .output-list { list-style: none; margin-top: 16px; }
        .output-item { display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f8fafc; border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 8px; font-size: 0.875rem; }
        
        /* Drag and Drop Merge */
        .draggable-item { cursor: grab; background: #ffffff; }
        .draggable-item:active { cursor: grabbing; }
        .draggable-item.dragging { opacity: 0.5; background: #f1f5f9; border: 2px dashed var(--accent-color); }
        .drag-handle { margin-right: 12px; color: var(--text-secondary); cursor: grab; font-size: 1.2rem; user-select: none; }
        
        .tools-section { display: none; } /* Hidden until upload */
        
        /* Header */
        .header { margin-bottom: 24px; }
        .header h1 { font-size: 1.75rem; color: var(--text-primary); }
        .header p { color: var(--text-secondary); }
    </style>
</head>
<body>

<div class="container">
    <!-- Sidebar / Input -->
    <div class="sidebar">
        <div class="header">
            <h1>Video Editor</h1>
            <p>Powered by Python & FFmpeg</p>
        </div>

        <div class="card" id="uploadCard">
            <div class="card-title">1. Upload Video</div>
            <div class="upload-area" id="dropZone">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-secondary); margin-bottom:12px;">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="17 8 12 3 7 8"></polyline>
                    <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                <p>Drag & drop video here<br><span style="font-size:0.8rem; color:var(--text-secondary)">or click to browse</span></p>
                <input type="file" id="fileInput" accept=".mp4,.mov,.avi,.mkv,.webm,.mpeg,.mpg">
            </div>
            <div id="uploadStatus" class="status-box" style="margin-top:16px;"></div>
        </div>

        <div class="card tools-section" id="metaCard">
            <div class="card-title">File Details</div>
            <table class="meta-table" id="metaTable">
                <tbody>
                    <!-- Injected via JS -->
                </tbody>
            </table>
        </div>
    </div>

    <!-- Main Workspace -->
    <div class="workspace tools-section" id="workspace">
        <div class="card">
            <div class="video-container" id="videoContainer">
                <video id="videoPlayer" controls></video>
                
                <!-- Millisecond Timestamp Overlay -->
                <div id="videoTimeOverlay">00:00:00.000</div>
                
                <!-- Interactive Crop Overlay -->
                <div id="cropEditor">
                    <div id="cropBox">
                        <div class="crop-handle handle-tl" data-dir="tl"></div>
                        <div class="crop-handle handle-tc" data-dir="tc"></div>
                        <div class="crop-handle handle-tr" data-dir="tr"></div>
                        <div class="crop-handle handle-ml" data-dir="ml"></div>
                        <div class="crop-handle handle-mr" data-dir="mr"></div>
                        <div class="crop-handle handle-bl" data-dir="bl"></div>
                        <div class="crop-handle handle-bc" data-dir="bc"></div>
                        <div class="crop-handle handle-br" data-dir="br"></div>
                        <div class="crop-info-badge" id="cropBadge">0x0</div>
                    </div>
                </div>
            </div>
        </div>

        <div class="grid-2">
            <!-- Split Tool -->
            <div class="card">
                <div class="card-title">Split Clips</div>
                <label for="durations">Sequential Durations (e.g., 10.5, 15, or 00:00:10.500)</label>
                <textarea id="durations" placeholder="10.5&#10;15.250&#10;30"></textarea>
                <button class="btn" id="btnSplit" onclick="processTask('split')">Generate Clips</button>
            <div id="splitStatus" class="status-box" style="margin-top:12px;"></div>
            <div id="splitOutputs"></div>
            
            <!-- Merge Section -->
            <div id="mergeSection" style="display: none; margin-top: 16px; border-top: 1px solid var(--border-color); padding-top: 16px;">
                <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 12px;">Drag and drop the clips above to reorder them, then click merge to combine them.</p>
                <button class="btn btn-success" id="btnMerge" onclick="processMerge()">Merge Clips in Current Sequence</button>
                <div id="mergeStatus" class="status-box" style="margin-top:12px;"></div>
                <div id="mergeOutputs"></div>
            </div>
        </div>

        <!-- Crop Tool -->
            <div class="card">
                <div class="card-title">Crop Video</div>
                <div class="grid-2" style="margin-bottom: 12px;">
                    <div>
                        <label>Aspect Ratio</label>
                        <select id="cropRatio" onchange="applyAspectRatio()">
                            <option value="free">Free</option>
                            <option value="1">1:1 (Square)</option>
                            <option value="1.777777">16:9 (Landscape)</option>
                            <option value="0.5625">9:16 (Portrait)</option>
                            <option value="1.333333">4:3</option>
                            <option value="0.75">3:4</option>
                        </select>
                    </div>
                    <div style="display: flex; align-items: flex-end; padding-bottom: 16px;">
                        <button class="btn btn-outline" onclick="resetCrop()" style="padding: 9px 12px;">Reset Full</button>
                    </div>
                </div>
                <div class="grid-2">
                    <div>
                        <label>X Offset (px)</label>
                        <input type="number" id="cropX" value="0" min="0" onchange="syncCropFromInputs()">
                    </div>
                    <div>
                        <label>Y Offset (px)</label>
                        <input type="number" id="cropY" value="0" min="0" onchange="syncCropFromInputs()">
                    </div>
                    <div>
                        <label>Width (px)</label>
                        <input type="number" id="cropW" value="1280" min="1" onchange="syncCropFromInputs()">
                    </div>
                    <div>
                        <label>Height (px)</label>
                        <input type="number" id="cropH" value="720" min="1" onchange="syncCropFromInputs()">
                    </div>
                </div>
                <button class="btn" id="btnCrop" onclick="processTask('crop')">Crop Video</button>
                <div id="cropStatus" class="status-box" style="margin-top:12px;"></div>
                <div id="cropOutputs"></div>
            </div>

            <!-- Extract Audio Tool -->
            <div class="card" style="grid-column: 1 / -1;">
                <div class="card-title">Extract Audio</div>
                <div class="grid-2">
                    <div>
                        <label>Format</label>
                        <select id="audioFormat" onchange="toggleAudioSettings()">
                            <option value="mp3">MP3</option>
                            <option value="wav">WAV</option>
                            <option value="aac">AAC</option>
                            <option value="m4a">M4A</option>
                            <option value="flac">FLAC</option>
                            <option value="ogg">OGG</option>
                        </select>
                    </div>
                    <div id="bitrateContainer">
                        <label>Bitrate</label>
                        <select id="audioBitrate">
                            <option value="64k">64 kbps</option>
                            <option value="128k">128 kbps</option>
                            <option value="192k" selected>192 kbps</option>
                            <option value="256k">256 kbps</option>
                            <option value="320k">320 kbps</option>
                        </select>
                    </div>
                    <div>
                        <label>Sample Rate</label>
                        <select id="audioSampleRate">
                            <option value="44100" selected>44100 Hz</option>
                            <option value="48000">48000 Hz</option>
                        </select>
                    </div>
                </div>
                <button class="btn" id="btnAudio" onclick="processTask('extract-audio')">Extract Audio</button>
                <div id="audioStatus" class="status-box" style="margin-top:12px;"></div>
                <div id="audioOutputs"></div>
            </div>
        </div>
    </div>
</div>

<script>
    let currentSession = null;
    let currentFilename = null;
    let videoMeta = null;

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const videoPlayer = document.getElementById('videoPlayer');

    // UI event listeners for drag and drop
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleUpload(e.target.files[0]);
    });

    function showStatus(elementId, type, message) {
        const el = document.getElementById(elementId);
        el.className = `status-box status-${type}`;
        el.innerText = message;
    }

    function toggleAudioSettings() {
        const format = document.getElementById('audioFormat').value;
        const container = document.getElementById('bitrateContainer');
        if (format === 'wav' || format === 'flac') {
            container.style.display = 'none';
        } else {
            container.style.display = 'block';
        }
    }

    async function handleUpload(file) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('video', file);
        
        showStatus('uploadStatus', 'info', 'Uploading and probing metadata...');
        
        try {
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Upload failed');
            
            currentSession = data.session_id;
            currentFilename = data.filename;
            videoMeta = data.metadata;
            
            showStatus('uploadStatus', 'success', `Uploaded: ${currentFilename}`);
            
            // Populate metadata
            const tbody = document.querySelector('#metaTable tbody');
            tbody.innerHTML = `
                <tr><th>Duration</th><td>${data.metadata.duration_formatted}</td></tr>
                <tr><th>Resolution</th><td>${data.metadata.width}x${data.metadata.height}</td></tr>
                <tr><th>FPS</th><td>${data.metadata.fps}</td></tr>
                <tr><th>Size</th><td>${data.metadata.size_formatted}</td></tr>
            `;
            
            // Show workspace & load video
            document.querySelectorAll('.tools-section').forEach(el => el.style.display = 'block');
            document.getElementById('videoTimeOverlay').style.display = 'block';
            videoPlayer.src = `/media/${currentSession}/${currentFilename}`;
            
        } catch (err) {
            showStatus('uploadStatus', 'error', err.message);
        }
    }

    /* --- Visual Crop Editor Logic --- */
    
    // Core actual coordinates (Source of Truth)
    let actualCrop = { x: 0, y: 0, w: 1280, h: 720 };
    
    const cropEditor = document.getElementById('cropEditor');
    const cropBox = document.getElementById('cropBox');
    const cropBadge = document.getElementById('cropBadge');
    
    // Calculate the physical rectangle of the video displayed inside the <video> tag
    function getVideoDisplayRect() {
        if (!videoMeta || !videoMeta.width || !videoMeta.height) return null;
        
        const vw = videoMeta.width;
        const vh = videoMeta.height;
        const cw = videoPlayer.clientWidth;
        const ch = videoPlayer.clientHeight;
        
        const videoRatio = vw / vh;
        const containerRatio = cw / ch;
        
        let dispW, dispH, dispX, dispY;
        
        if (containerRatio > videoRatio) {
            // Pillarboxing
            dispH = ch;
            dispW = ch * videoRatio;
            dispX = (cw - dispW) / 2;
            dispY = 0;
        } else {
            // Letterboxing
            dispW = cw;
            dispH = cw / videoRatio;
            dispX = 0;
            dispY = (ch - dispH) / 2;
        }
        
        return {
            x: dispX, y: dispY,
            w: dispW, h: dispH,
            scaleX: dispW / vw,
            scaleY: dispH / vh
        };
    }

    // Re-render the visual crop box overlay based on actual coordinates
    function renderCropOverlay() {
        if (!videoMeta) return;
        const rect = getVideoDisplayRect();
        if (!rect) return;
        
        // 1. Position the main mask exactly over the visible video
        cropEditor.style.display = 'block';
        cropEditor.style.left = `${rect.x}px`;
        cropEditor.style.top = `${rect.y}px`;
        cropEditor.style.width = `${rect.w}px`;
        cropEditor.style.height = `${rect.h}px`;
        
        // 2. Map actual crop to screen pixels
        const screenX = actualCrop.x * rect.scaleX;
        const screenY = actualCrop.y * rect.scaleY;
        const screenW = actualCrop.w * rect.scaleX;
        const screenH = actualCrop.h * rect.scaleY;
        
        // 3. Apply to box
        cropBox.style.left = `${screenX}px`;
        cropBox.style.top = `${screenY}px`;
        cropBox.style.width = `${screenW}px`;
        cropBox.style.height = `${screenH}px`;
        
        cropBadge.innerText = `${Math.round(actualCrop.w)}x${Math.round(actualCrop.h)}`;
    }

    // Update variables from manual inputs
    function syncCropFromInputs() {
        if (!videoMeta) return;
        
        let nx = parseInt(document.getElementById('cropX').value) || 0;
        let ny = parseInt(document.getElementById('cropY').value) || 0;
        let nw = parseInt(document.getElementById('cropW').value) || videoMeta.width;
        let nh = parseInt(document.getElementById('cropH').value) || videoMeta.height;
        
        // Clamp to video boundaries
        nx = Math.max(0, Math.min(nx, videoMeta.width - 1));
        ny = Math.max(0, Math.min(ny, videoMeta.height - 1));
        nw = Math.max(1, Math.min(nw, videoMeta.width - nx));
        nh = Math.max(1, Math.min(nh, videoMeta.height - ny));
        
        actualCrop = { x: nx, y: ny, w: nw, h: nh };
        updateInputFields(); // Push clamped values back to UI
        renderCropOverlay();
    }

    // Update manual input DOM fields from the actual variables
    function updateInputFields() {
        document.getElementById('cropX').value = Math.round(actualCrop.x);
        document.getElementById('cropY').value = Math.round(actualCrop.y);
        document.getElementById('cropW').value = Math.round(actualCrop.w);
        document.getElementById('cropH').value = Math.round(actualCrop.h);
    }

    function resetCrop() {
        if (!videoMeta) return;
        actualCrop = { x: 0, y: 0, w: videoMeta.width, h: videoMeta.height };
        document.getElementById('cropRatio').value = 'free';
        updateInputFields();
        renderCropOverlay();
    }

    function applyAspectRatio() {
        if (!videoMeta) return;
        const ratioVal = document.getElementById('cropRatio').value;
        if (ratioVal === 'free') return;
        
        const ratio = parseFloat(ratioVal);
        let nw = actualCrop.w;
        let nh = actualCrop.h;
        
        // Center-based adjustment to snap to aspect ratio
        if (nw / nh > ratio) {
            nw = nh * ratio;
        } else {
            nh = nw / ratio;
        }
        
        actualCrop.w = Math.round(nw);
        actualCrop.h = Math.round(nh);
        
        // Re-center if possible, or clamp
        actualCrop.x = Math.min(actualCrop.x, videoMeta.width - actualCrop.w);
        actualCrop.y = Math.min(actualCrop.y, videoMeta.height - actualCrop.h);
        
        updateInputFields();
        renderCropOverlay();
    }

    /* Interaction logic for dragging and resizing */
    let isDragging = false;
    let dragAction = null; // 'move' or handle dir ('tl', 'br', etc.)
    let startMouseX = 0, startMouseY = 0;
    let startActualCrop = null;

    cropBox.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent selection
        isDragging = true;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        startActualCrop = { ...actualCrop };
        
        if (e.target.classList.contains('crop-handle')) {
            dragAction = e.target.getAttribute('data-dir');
        } else {
            dragAction = 'move';
        }
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging || !startActualCrop || !videoMeta) return;
        
        const rect = getVideoDisplayRect();
        if (!rect) return;
        
        // Delta converted from screen pixels to actual video pixels
        const deltaX = (e.clientX - startMouseX) / rect.scaleX;
        const deltaY = (e.clientY - startMouseY) / rect.scaleY;
        
        let newX = startActualCrop.x;
        let newY = startActualCrop.y;
        let newW = startActualCrop.w;
        let newH = startActualCrop.h;
        
        const ratioVal = document.getElementById('cropRatio').value;
        const ratio = ratioVal === 'free' ? null : parseFloat(ratioVal);
        
        if (dragAction === 'move') {
            newX += deltaX;
            newY += deltaY;
            // Clamp Move
            newX = Math.max(0, Math.min(newX, videoMeta.width - newW));
            newY = Math.max(0, Math.min(newY, videoMeta.height - newH));
        } else {
            // Resize handling based on direction
            if (dragAction.includes('l')) { newX += deltaX; newW -= deltaX; }
            if (dragAction.includes('r')) { newW += deltaX; }
            if (dragAction.includes('t')) { newY += deltaY; newH -= deltaY; }
            if (dragAction.includes('b')) { newH += deltaY; }
            
            // Enforce Minimums
            if (newW < 10) { newX = startActualCrop.x + startActualCrop.w - 10; newW = 10; }
            if (newH < 10) { newY = startActualCrop.y + startActualCrop.h - 10; newH = 10; }
            
            // Apply Aspect Ratio Constraint (approximated on primary drag axis)
            if (ratio) {
                // Determine primary changing axis to drive the other
                if (dragAction === 'ml' || dragAction === 'mr' || Math.abs(deltaX) > Math.abs(deltaY)) {
                    // Width drives Height
                    const targetH = newW / ratio;
                    if (dragAction.includes('t')) newY = (startActualCrop.y + startActualCrop.h) - targetH;
                    newH = targetH;
                } else {
                    // Height drives Width
                    const targetW = newH * ratio;
                    if (dragAction.includes('l')) newX = (startActualCrop.x + startActualCrop.w) - targetW;
                    newW = targetW;
                }
            }
            
            // Clamp to boundaries safely (shrinking if necessary)
            if (newX < 0) { newW += newX; newX = 0; }
            if (newY < 0) { newH += newY; newY = 0; }
            if (newX + newW > videoMeta.width) { newW = videoMeta.width - newX; }
            if (newY + newH > videoMeta.height) { newH = videoMeta.height - newY; }
            
            // Re-apply ratio strictly if boundary hit
            if (ratio) {
                if (newW / newH > ratio) {
                    newW = newH * ratio;
                } else {
                    newH = newW / ratio;
                }
            }
        }
        
        actualCrop = { x: newX, y: newY, w: newW, h: newH };
        updateInputFields();
        renderCropOverlay();
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
        dragAction = null;
    });

    // Window resize handling
    window.addEventListener('resize', renderCropOverlay);
    
    // Initialize crop tool when video finishes loading metadata
    videoPlayer.addEventListener('loadedmetadata', () => {
        // Only reset to full if it's the first time processing this video
        actualCrop = { x: 0, y: 0, w: videoMeta.width, h: videoMeta.height };
        updateInputFields();
        renderCropOverlay();
    });

    // Millisecond timestamp updater
    function updateTimeOverlay() {
        if (videoPlayer && videoPlayer.readyState > 0) {
            const t = videoPlayer.currentTime;
            const h = Math.floor(t / 3600).toString().padStart(2, '0');
            const m = Math.floor((t % 3600) / 60).toString().padStart(2, '0');
            const s = (t % 60).toFixed(3).padStart(6, '0');
            document.getElementById('videoTimeOverlay').innerText = `${h}:${m}:${s}`;
        }
        requestAnimationFrame(updateTimeOverlay); // Syncs with browser refresh rate for smooth display
    }
    requestAnimationFrame(updateTimeOverlay);

    /* --- Drag and Drop Logic for Merging --- */
    let draggedItem = null;

    document.getElementById('splitOutputs').addEventListener('dragstart', (e) => {
        const item = e.target.closest('.draggable-item');
        if (item) {
            draggedItem = item;
            // Delay adding class so the drag image doesn't look transparent
            requestAnimationFrame(() => item.classList.add('dragging'));
        }
    });

    document.getElementById('splitOutputs').addEventListener('dragend', (e) => {
        const item = e.target.closest('.draggable-item');
        if (item) {
            item.classList.remove('dragging');
            draggedItem = null;
        }
    });

    document.getElementById('splitOutputs').addEventListener('dragover', (e) => {
        e.preventDefault(); // allow drop
        if (!draggedItem) return;
        const container = document.getElementById('sortableClipList');
        if (!container) return;
        
        const afterElement = getDragAfterElement(container, e.clientY);
        if (afterElement == null) {
            container.appendChild(draggedItem);
        } else {
            container.insertBefore(draggedItem, afterElement);
        }
    });

    function getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.draggable-item:not(.dragging)')];
        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2; // middle of the child element
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async function processMerge() {
        if (!currentSession) return;
        const list = document.getElementById('sortableClipList');
        if (!list) return;
        
        const items = list.querySelectorAll('.draggable-item');
        const filesInOrder = Array.from(items).map(item => item.getAttribute('data-filename'));
        
        if (filesInOrder.length < 2) {
            showStatus('mergeStatus', 'error', 'Need at least 2 clips to merge.');
            return;
        }
        
        const btn = document.getElementById('btnMerge');
        btn.disabled = true;
        showStatus('mergeStatus', 'info', 'Merging clips in the selected order...');
        document.getElementById('mergeOutputs').innerHTML = '';
        
        try {
            const res = await fetch('/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ session_id: currentSession, files: filesInOrder })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Merge failed');
            
            showStatus('mergeStatus', 'success', 'Clips merged successfully!');
            document.getElementById('mergeOutputs').innerHTML = `
                <ul class="output-list">
                    <li class="output-item">
                        <span>${data.file}</span>
                        <a href="/download/${currentSession}/${data.file}" class="btn btn-success" style="width:auto; padding:4px 8px" download>Download Merged Video</a>
                    </li>
                </ul>`;
        } catch (err) {
            showStatus('mergeStatus', 'error', err.message);
        } finally {
            btn.disabled = false;
        }
    }

    async function processTask(taskName) {
        if (!currentSession) return;
        
        // Define endpoints and button IDs mapping
        const config = {
            'split': { btn: 'btnSplit', status: 'splitStatus', outputs: 'splitOutputs', getBody: () => ({ durations: document.getElementById('durations').value }) },
            'crop': { btn: 'btnCrop', status: 'cropStatus', outputs: 'cropOutputs', getBody: () => ({ 
                x: Math.round(actualCrop.x), 
                y: Math.round(actualCrop.y), 
                w: Math.round(actualCrop.w), 
                h: Math.round(actualCrop.h) 
            }) },
            'extract-audio': { btn: 'btnAudio', status: 'audioStatus', outputs: 'audioOutputs', getBody: () => ({ format: document.getElementById('audioFormat').value, bitrate: document.getElementById('audioBitrate').value, sample_rate: document.getElementById('audioSampleRate').value }) }
        };
        
        const c = config[taskName];
        const btn = document.getElementById(c.btn);
        
        btn.disabled = true;
        showStatus(c.status, 'info', 'Processing... Please wait.');
        document.getElementById(c.outputs).innerHTML = '';
        
        try {
            const bodyData = { session_id: currentSession, filename: currentFilename, ...c.getBody() };
            const res = await fetch(`/${taskName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyData)
            });
            const data = await res.json();
            
            if (!res.ok) throw new Error(data.error || 'Processing failed');
            
            showStatus(c.status, 'success', 'Completed successfully!');
            
            // Render outputs
            let html = `<ul class="output-list" ${taskName === 'split' ? 'id="sortableClipList"' : ''}>`;
            if (data.files && Array.isArray(data.files)) {
                data.files.forEach(f => {
                    const dragAttr = taskName === 'split' ? `draggable="true" class="output-item draggable-item" data-filename="${f}"` : `class="output-item"`;
                    const dragHandle = taskName === 'split' ? `<span class="drag-handle">☰</span>` : '';
                    html += `
                        <li ${dragAttr}>
                            <div style="display:flex; align-items:center;">
                                ${dragHandle}
                                <span>${f}</span>
                            </div>
                            <a href="/download/${currentSession}/${f}" class="btn btn-outline" style="width:auto; padding:4px 8px" download>Download</a>
                        </li>`;
                });
                if (data.files.length > 1) {
                    html += `
                        <li class="output-item" style="background: var(--surface-color); border: none; padding: 12px 0 0 0; cursor: default;">
                            <a href="/download-zip/${currentSession}" class="btn btn-success" style="width:100%">Download All (ZIP)</a>
                        </li>`;
                }
            } else if (data.file) {
                html += `
                    <li class="output-item">
                        <span>${data.file}</span>
                        <a href="/download/${currentSession}/${data.file}" class="btn btn-outline" style="width:auto; padding:4px 8px" download>Download</a>
                    </li>`;
            }
            html += '</ul>';
            document.getElementById(c.outputs).innerHTML = html;
            
            if (taskName === 'split') {
                const mergeSection = document.getElementById('mergeSection');
                if (data.files && data.files.length > 1) {
                    mergeSection.style.display = 'block';
                    document.getElementById('mergeOutputs').innerHTML = ''; // reset previous merge
                } else {
                    mergeSection.style.display = 'none';
                }
            }
            
        } catch (err) {
            showStatus(c.status, 'error', err.message);
        } finally {
            btn.disabled = false;
        }
    }
</script>
</body>
</html>
"""

@app.route('/')
def index():
    if not check_ffmpeg():
        return "<h1>Error: FFmpeg or FFprobe not found.</h1><p>Please install FFmpeg and ensure it is added to your system's PATH.</p>", 500
    return render_template_string(HTML_TEMPLATE)

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
    return send_from_directory(directory, filename)

@app.route('/download/<session_id>/<filename>')
def download_file(session_id, filename):
    session_id = secure_filename(session_id)
    filename = secure_filename(filename)
    directory = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    return send_from_directory(directory, filename, as_attachment=True)

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
        durations = parse_durations(duration_text)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
        
    if not durations:
        return jsonify({'error': 'No valid durations provided'}), 400
        
    session_dir = os.path.join(app.config['UPLOAD_FOLDER'], f"session_{session_id}")
    input_path = os.path.join(session_dir, filename)
    
    if not os.path.exists(input_path):
        return jsonify({'error': 'Source file not found'}), 404
        
    output_files = []
    current_start = 0.0
    
    for i, dur in enumerate(durations):
        out_name = f"clip_{i+1:02d}.mp4"
        out_path = os.path.join(session_dir, out_name)
        
        # Using -preset veryfast to speed up re-encoding while maintaining precise cuts
        cmd = [
            'ffmpeg', '-y', 
            '-ss', str(current_start), 
            '-t', str(dur), 
            '-i', input_path, 
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
            '-c:a', 'aac', '-b:a', '192k',
            out_path
        ]
        
        try:
            subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
            output_files.append(out_name)
            current_start += dur
        except subprocess.CalledProcessError as e:
            return jsonify({'error': f"FFmpeg failed on clip {i+1}. Error snippet: {e.stderr.decode()[-200:]}"}), 500
            
    return jsonify({'message': 'Success', 'files': output_files})

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
            
    out_name = "merged_video.mp4"
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
        return jsonify({'message': 'Success', 'file': out_name})
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