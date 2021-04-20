// BlazorAudioLib v1.0 by Carl Franklin
// Catch Carl's excellent Blazor Developer show, BlazorTrain at https://blazortrain.com
// Carl is Executive VP of App vNext, a software consultancy in Southeastern Connecticut.
// Contact him at carl@appvnext.com

// This Javascript is required by the BlazorAudioLib Razor Component.
// It is also dependent on RecordRTC.min.js (or RecordRTC.js)


// GLOBALS
var mediaDeviceLibDotNetRef;
var firstEnumeration = true;
var recordingDotnetHelper;  // .NET reference we can call from JavaScript.
var cfAudioContext;         // Audio Context (Web Audio API)
var cfAudioStartTime = 0;   // Used to synchronize playback buffers
var cfAudioQueue;           // An array used as a queue for audio buffers
var cfAudioSampleRate = 0;  // Gets set by calling code
var cfAudioChannels = 1;    // 1 = mono, 2 = stereo
var cfCancelAudioPlayback = false;  // Flag to cancel audio playback
var cfRecorder;             // RecordRTC Recorder
var cfAudioInputDeviceId;   // Device ID of the selected audio input device

// --------------------------------------------
// Audio Picker
//  Code for enumerating audio input devices
// --------------------------------------------

// enumerate audio and video devices
window.EnumerateDevices = (dotNetObject) => {
    mediaDeviceLibDotNetRef = dotNetObject;
    if (!window.AudioContext) {
        if (!window.webkitAudioContext) {
            mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", "Your browser does not support AudioContext.");
            return;
        }
        window.AudioContext = window.webkitAudioContext;
    }
    if (window.AudioContext) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
            mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", "enumerateDevices() not supported.");
            return;
        }
        // try using getUserMedia, which doesn't always work
        navigator.mediaDevices.getUserMedia({ audio: true, video: true })
            .then(function (stream) {
                navigator.mediaDevices.enumerateDevices({ audio: true, video: true })
                    .then(function (devices) {
                        if (devices == null || devices.length == 0) {
                            mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", "no devices found");
                            return;
                        }
                        // Call the .NET reference passing the array of devices
                        mediaDeviceLibDotNetRef.invokeMethodAsync("AvailableDevices", devices);
                    })
                    .catch(function (err) {
                        mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", err.name + ": " + err.message);

                    });
            })
            .catch(function (err) {
                mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", err.name + ": " + err.message);
                enumerateJitsiDevices();
            });

        // also try going straight to enumerateDevices
        navigator.mediaDevices.enumerateDevices({ audio: true, video: true })
            .then(function (devices) {
                if (devices == null || devices.length == 0) {
                    mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", "no devices found");
                    return;
                }
                // Call the .NET reference passing the array of devices
                mediaDeviceLibDotNetRef.invokeMethodAsync("AvailableDevices", devices);
            })
            .catch(function (err) {
                mediaDeviceLibDotNetRef.invokeMethodAsync("DeviceStatusChanged", err.name + ": " + err.message);
            });
    }
}

// --------------------------------------------
// Player
//   Code for playing back audio from buffers
// --------------------------------------------

// Called from Blazor Component before playing
window.InitializeAudioPlayer = (channels, samplerate) => {
    if (cfAudioContext != null) {
        cfAudioContext.close();
    }
    if (!window.AudioContext) {
        if (!window.webkitAudioContext) {
            alert("Your browser does not support AudioContext.");
            return;
        }
        window.AudioContext = window.webkitAudioContext;
    }
    // Set the sample rate
    if (samplerate != 0) {
        cfAudioSampleRate = samplerate;
    }
    else {
        cfAudioSampleRate = 16000;  // default sample rate
    }
    // Set the number of channels
    if (channels == 1 || channels == 2) {
        cfAudioChannels = channels;
    }
    else {
        cfAudioChannels = 1;    // default channels (MONO)
    }
    // Create the audio context from the sample rate
    cfAudioContext = new AudioContext({ sampleRate: cfAudioSampleRate, latencyHint: 'interactive' });
    // Set the number of channels
    cfAudioContext.numberOfAudioChannels = channels;
    // Prepare the queue
    if (cfAudioQueue != null) {
        if (cfAudioQueue.length > 0) {
            cfAudioQueue.splice(0, cfAudioQueue.length);
        }
    }
    else {
        cfAudioQueue = [];
    }
    // Default the start time to zero.
    cfAudioStartTime = 0;
}

// Called from the Blazor component to stop playback
window.StopPlaying = () => {
    cfCancelAudioPlayback = true;
}

// Called internally to get the next buffer and play it.
function PlayNextBuffer() {
    // Only continue if playback is enabled
    if (!cfCancelAudioPlayback) {
        // Only play the next buffer if there are at least four buffers in the queue.
        if (cfAudioQueue != null && cfAudioQueue.length > 4) {
            // Remove the next buffer
            var buffer = cfAudioQueue[0];
            cfAudioQueue.shift();
            // Create a buffer source for the audio context
            var source = cfAudioContext.createBufferSource();
            source.buffer = buffer;
            // Calculate the start time if it's zero
            if (cfAudioStartTime == 0) {
                cfAudioStartTime = cfAudioContext.currentTime
                    + (buffer.length / cfAudioSampleRate) / 2;
            }
            // Tell the system to start playing the buffer at the given start time
            source.start(cfAudioStartTime);
            // Connect this source to the audio output
            source.connect(cfAudioContext.destination);
            // SO IMPORTANT: Calculate the start time for the NEXT buffer.
            cfAudioStartTime += buffer.length / cfAudioSampleRate;
        }
        // Call ourselves again in 10 ms
        setTimeout(PlayNextBuffer, 10);
    }
}

// Kicks off the playback process. 
window.StartPlaying = () => {
    // Set the defautls and play the next buffer
    console.log("window.StartPlaying");
    cfAudioStartTime = 0;
    cfCancelAudioPlayback = false;
    PlayNextBuffer();
}

// Add a buffer to the queue
window.AddBuffer = (base64_string) => {
    var dataUrl = "data:application/octet-binary;base64," + base64_string;
    // convert the base 64 string into a byte array
    fetch(dataUrl)
        .then(res => res.arrayBuffer())
        .then(buffer => {
            // once we have a byte array, decode it and call enqueue_audio_buffer
            cfAudioContext.decodeAudioData(buffer, enqueue_audio_buffer);
        })
}

function enqueue_audio_buffer(audioBuffer) {
    cfAudioQueue.push(audioBuffer);
}

// --------------------------------------------
// Recorder
//  Records data from audio source and pushes
//  buffers to the Blazor component
// --------------------------------------------


// Called by the Blazor component to start recording
window.StartRecordingWav = (inputDeviceId, timeslice, dotnetHelper, channels, samplerate) => {
    // Reference to .NET component, so we can call it back when we have a buffer.
    recordingDotnetHelper = dotnetHelper;
    cfAudioInputDeviceId = inputDeviceId;   // Save the device id
    // use the default device if not specified
    if (cfAudioInputDeviceId == "") {
        recordingDotnetHelper.invokeMethodAsync("RecordingStatus", "AudioInputDeviceId was ''");
        cfAudioInputDeviceId = "default";
    }
    // Update the status
    recordingDotnetHelper.invokeMethodAsync("RecordingStatus", "INPUT DEVICE: " + cfAudioInputDeviceId);
    // call internal function to capture the mic input and pass it here
    captureMicrophone(function (microphone) {
        // create a new RecordRTC Recorder
        cfRecorder = RecordRTC(microphone, {
            recorderType: StereoAudioRecorder,
            timeSlice: timeslice,
            desiredSampRate: samplerate,
            numberOfAudioChannels: channels,
            ondataavailable: function (blob) {
                // we have a buffer!!
                try {
                    // convert it to a base 64 string
                    var reader = new window.FileReader();
                    reader.readAsDataURL(blob);
                    reader.onloadend = function () {
                        var base64String = reader.result;
                        base64String = base64String.split(',')[1];
                        // Call the Blazor component DataAvailable
                        recordingDotnetHelper.invokeMethodAsync("DataAvailable", base64String);
                    }
                }
                catch (err) {
                    console.log(err);
                }
            }
        });
        // Start recording and update the status!
        cfRecorder.startRecording();
        cfRecorder.microphone = microphone;
        recordingDotnetHelper.invokeMethodAsync("RecordingStatus", "Recording");
    });
}

// Internal function called by StartRecordingWav
function captureMicrophone(callback) {
    if (cfAudioInputDeviceId == '') {
        navigator.mediaDevices.getUserMedia({
            audio: true
        }).then(function (microphone) {
            callback(microphone);
        }).catch(function (error) {
            alert('Unable to capture your microphone. Please check console logs.');
            console.error(error);
        });
    }
    else {
        navigator.mediaDevices.getUserMedia({
            audio: { deviceId: cfAudioInputDeviceId }
        }).then(function (microphone) {
            callback(microphone);
        }).catch(function (error) {
            alert('Unable to capture your microphone. Please check console logs.');
            console.error(error);
        });
    }
}

// Called by the Blazor component to stop recording;
window.StopRecordingWav = () => {
    if (cfRecorder != null) {
        cfRecorder.stopRecording(stopRecordingCallback);
    }
}
// happens when we stop recording
function stopRecordingCallback() {
    if (cfRecorder != null) {
        cfRecorder.microphone.stop();
        cfRecorder = null;
        recordingDotnetHelper.invokeMethodAsync("RecordingStatus", "Stopped");
    }
}
