import React, { useState, useRef } from 'react';
import { Play, Pause, Square, Mic, Upload, Download } from 'lucide-react';

const AudioAnalysisScorer = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioData, setAudioData] = useState(null);
  const [analysisResults, setAnalysisResults] = useState(null);
  const [score, setScore] = useState(null);
  const [recordingStatus, setRecordingStatus] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const animationRef = useRef(null);
  const chunksRef = useRef([]);

  const initAudioContext = async () => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext ||
          window.webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }
      return true;
    } catch (err) {
      console.error(err);
      setRecordingStatus('Audio context initialization failed');
      return false;
    }
  };

  const startRecording = async () => {
    if (!(await initAudioContext())) return;

    try {
      setRecordingStatus('Requesting microphone access...');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      setRecordingStatus('Mic access granted');
      chunksRef.current = [];

      // MIME type selection
      let mimeType = 'audio/webm';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : 'audio/wav';
      }

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onerror = (e) => {
        console.error('MediaRecorder error:', e.error);
        setRecordingStatus('Recording error: ' + e.error.message);
      };

      mediaRecorder.onstart = () => {
        setRecordingStatus('Recording in progress...');
      };

      mediaRecorder.onstop = async () => {
        setRecordingStatus('Processing recording...');
        const blob = new Blob(chunksRef.current, { type: mimeType });
        const audioURL = URL.createObjectURL(blob);
        setAudioData(audioURL);

        try {
          await analyzeAudio(blob);
          setRecordingStatus('Recording complete!');
        } catch (err) {
          console.error('Analysis failed:', err);
          setRecordingStatus('Analysis error: ' + err.message);
        }

        stream.getTracks().forEach((t) => t.stop());
      };

      // ✅ Set up analyser node before calling visualizeAudio
      const audioSource =
        audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      audioSource.connect(analyser);
      analyserRef.current = analyser;

      // ✅ Now it's safe to visualize
      visualizeAudio();

      setIsRecording(true);
      mediaRecorder.start(250);
    } catch (err) {
      console.error('startRecording error:', err);
      const msg =
        err.name === 'NotAllowedError'
          ? 'Microphone access denied'
          : err.name === 'NotFoundError'
            ? 'No microphone detected'
            : err.message;
      setRecordingStatus('Error starting recording: ' + msg);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.state === 'recording' &&
      mediaRecorderRef.current.stop();
    setIsRecording(false);
    cancelAnimationFrame(animationRef.current);
  };

  const visualizeAudio = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.fillStyle = 'rgb(20,20,20)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 2.5;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = `hsl(${(i / bufferLength) * 360}, 70%, 50%)`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 1;
      }
    };
    draw();
  };

  const analyzeAudio = async (blob) => {
    console.log('analyzeAudio called');

    try {
      const arrayBuffer = await blob.arrayBuffer();
      console.log('Blob arrayBuffer size:', arrayBuffer.byteLength);

      const audioBuffer =
        await audioContextRef.current.decodeAudioData(arrayBuffer);
      console.log('Decoded audioBuffer:', audioBuffer);

      const data = audioBuffer.getChannelData(0);
      const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
      let peak = 0;
      data.forEach((v) => {
        const abs = Math.abs(v);
        if (abs > peak) peak = abs;
      });
      const duration = audioBuffer.duration;
      const sr = audioBuffer.sampleRate;
      const fundamentalFreq = estimatePitch(data, sr);

      const analysis = { duration, sampleRate: sr, rms, peak, fundamentalFreq };
      setAnalysisResults(analysis);

      const simpleScore = {
        total: Math.min(100, Math.round(rms * 1000 + duration * 10)),
        breakdown: {
          volume: Math.min(100, Math.round(rms * 1000)),
          duration: Math.min(100, Math.round(duration * 10)),
          clarity: Math.min(100, Math.round(peak * 100)),
          pitch: fundamentalFreq > 0 ? 75 : 25,
        },
        grade: ['F', 'D', 'C', 'B', 'A'][
          Math.floor(Math.min(100, rms * 1000 + duration * 10) / 20)
        ],
      };
      setScore(simpleScore);
    } catch (err) {
      console.error('analyzeAudio fatal error:', err);
      setRecordingStatus('Error analyzing audio: ' + err.message);
    }
  };

  const estimatePitch = (buffer, sampleRate) => {
    const SIZE = 2048; // <- reduced from buffer.length
    const MAX_SAMPLES = SIZE / 2;
    const slice = buffer.slice(0, SIZE); // only use a small portion
    let bestOffset = -1,
      bestCorrelation = 0;

    const rms = Math.sqrt(slice.reduce((s, v) => s + v * v, 0) / SIZE);
    if (rms < 0.01) return -1;

    for (let offset = 1; offset < MAX_SAMPLES; offset++) {
      let corr = 0;
      for (let i = 0; i < MAX_SAMPLES; i++) {
        corr += Math.abs(slice[i] - slice[i + offset]);
      }
      corr = 1 - corr / MAX_SAMPLES;
      if (corr > bestCorrelation && corr > 0.9) {
        bestCorrelation = corr;
        bestOffset = offset;
      }
    }

    const freq = bestOffset > 0 ? sampleRate / bestOffset : -1;
    console.log('Estimated pitch:', freq);
    return freq;
  };

  const playAudio = () => {
    audioRef.current.play();
    setIsPlaying(true);
  };
  const pauseAudio = () => {
    audioRef.current.pause();
    setIsPlaying(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioData(url);
      await analyzeAudio(file);
    }
  };

  const downloadResults = () => {
    if (!score || !analysisResults) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { score, analysisResults, timestamp: new Date().toISOString() },
          null,
          2
        ),
      ],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audio-analysis.json';
    a.click();
  };

  const testMicrophone = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      setRecordingStatus('Microphone test successful!');
      s.getTracks().forEach((t) => t.stop());
    } catch (err) {
      setRecordingStatus('Mic test failed: ' + err.message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6 bg-gray-50 min-h-screen">
      <div className="bg-white p-6 rounded-lg shadow-lg">
        <h1 className="text-3xl text-center font-bold mb-8">
          Inner Sound Lab - Audio Analysis & Scoring
        </h1>
        {recordingStatus && (
          <div className="mb-4 p-3 bg-blue-50 border-blue-200 border rounded">
            <p className="text-blue-800 text-sm">{recordingStatus}</p>
          </div>
        )}
        <div className="flex justify-center mb-4 space-x-4">
          <button
            onClick={testMicrophone}
            className="px-4 py-2 bg-gray-500 hover:bg-gray-600 text-white rounded font-semibold"
          >
            Test Microphone
          </button>
        </div>
        <div className="flex justify-center mb-8 space-x-4">
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`${isRecording ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-500 hover:bg-blue-600'} px-6 py-3 rounded-lg text-white font-semibold flex items-center space-x-2`}
          >
            {isRecording ? <Square size={20} /> : <Mic size={20} />}{' '}
            <span>{isRecording ? 'Stop Recording' : 'Start Recording'}</span>
          </button>
          <label className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold cursor-pointer flex items-center space-x-2">
            <Upload size={20} /> <span>Upload Audio</span>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleFileUpload}
            />
          </label>
        </div>
        {isRecording && (
          <div className="text-center mb-4">
            <div className="flex items-center justify-center space-x-2 bg-red-100 text-red-800 px-4 py-2 rounded-full">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
              <span className="font-medium">
                Recording… Speak into your mic
              </span>
            </div>
          </div>
        )}
        <div className="mb-8">
          <h3 className="text-lg font-semibold mb-4">
            Live Audio Visualization
          </h3>
          <canvas
            ref={canvasRef}
            width={800}
            height={150}
            className="w-full bg-gray-900 border rounded-lg"
          />
        </div>
        {audioData && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-4">Recorded Audio</h3>
            <div className="flex items-center mb-4 space-x-4">
              <button
                onClick={isPlaying ? pauseAudio : playAudio}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded flex items-center space-x-2"
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                <span>{isPlaying ? 'Pause' : 'Play'}</span>
              </button>
            </div>
            <audio
              ref={audioRef}
              src={audioData}
              onEnded={() => setIsPlaying(false)}
              controls
              className="w-full"
            />
          </div>
        )}
        {score && analysisResults && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold mb-4">Analysis Results</h3>
            <div className="mb-6 p-6 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg">
              <div className="flex justify-between">
                <div>
                  <h4 className="text-2xl font-bold">
                    Overall Score: {score.total}/100
                  </h4>
                  <p className="text-lg">Grade: {score.grade}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm opacity-90">
                    Duration: {analysisResults.duration.toFixed(2)}s
                  </p>
                  <p className="text-sm opacity-90">
                    Pitch:{' '}
                    {analysisResults.fundamentalFreq > 0
                      ? Math.round(analysisResults.fundamentalFreq) + ' Hz'
                      : 'Not detected'}
                  </p>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {['volume', 'duration', 'clarity', 'pitch'].map((key) => (
                <div
                  key={key}
                  className={`p-4 rounded-lg bg-${{ volume: 'blue', duration: 'green', clarity: 'purple', pitch: 'orange' }[key]}-50`}
                >
                  <h5
                    className={`font-semibold text-${{ volume: 'blue', duration: 'green', clarity: 'purple', pitch: 'orange' }[key]}-800 mb-2`}
                  >
                    {key.charAt(0).toUpperCase() + key.slice(1)} Level
                  </h5>
                  <div className="flex items-center space-x-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-3">
                      <div
                        className={`h-3 rounded-full bg-${{ volume: 'blue', duration: 'green', clarity: 'purple', pitch: 'orange' }[key]}-600 transition-all duration-500`}
                        style={{ width: `${score.breakdown[key]}%` }}
                      />
                    </div>
                    <span
                      className={`font-semibold text-${{ volume: 'blue', duration: 'green', clarity: 'purple', pitch: 'orange' }[key]}-800`}
                    >
                      {score.breakdown[key]}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={downloadResults}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded"
            >
              <Download size={16} /> <span>Download Results</span>
            </button>
          </div>
        )}
        <div className="bg-gray-100 p-4 rounded-lg">
          <h4 className="font-semibold mb-2">How to Use:</h4>
          <ul className="text-gray-700 text-sm space-y-1">
            <li>1. First, test your microphone.</li>
            <li>2. Click “Start Recording” and allow mic access.</li>
            <li>3. Chant or hum steadily into your mic.</li>
            <li>4. Watch the live frequency visualization.</li>
            <li>5. Click “Stop Recording” when finished.</li>
            <li>6. Review your analysis and results.</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default AudioAnalysisScorer;
