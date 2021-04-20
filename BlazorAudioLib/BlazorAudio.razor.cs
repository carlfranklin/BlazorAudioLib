using System;
using System.Collections.Generic;
using System.Text;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Web;
using Microsoft.JSInterop;
using System.Text.Json;
using System.Linq;
using System.IO;

namespace BlazorAudioLib
{
    /// <summary>
    /// Carl Franklin's BlazorAudio Razor Component.
    /// Requires 2 JavaScript files:
    ///         RecordRTC.min.js
    ///         BlazorAudioLib.js
    /// </summary>
    public partial class BlazorAudio : ComponentBase
    {
        // Parameters
        [Parameter]
        public EventCallback<AudioBuffer> BufferRecorded { get; set; }
        [Parameter]
        public EventCallback<string> DeviceStatusChanged { get; set; }
        [Parameter]
        public EventCallback<string> RecordingStatusChanged { get; set; }
        [Parameter]
        public int SampleRate { get; set; } = 16000;
        [Parameter]
        public int Channels { get; set; } = 1;
        [Parameter]
        public int TimeSliceInMilliseconds { get; set; } = 500;
        [Parameter]
        public int BuffersBeforePlayback { get; set; } = 4;

        [Parameter]
        public List<BrowserMediaDevice> AudioInputDevices { get; set; } = new List<BrowserMediaDevice>();

        [Parameter]
        public List<BrowserMediaDevice> AudioOutputDevices { get; set; } = new List<BrowserMediaDevice>();

        [Parameter]
        public List<BrowserMediaDevice> VideoInputDevices { get; set; } = new List<BrowserMediaDevice>();

        // Properties

        public bool Recording { get; set; } = false;
        // Privates
        int BufferCount = 0;

        public async Task StartRecording(string DeviceId)
        {
            // Initialize First
            await js.InvokeVoidAsync("InitializeAudioPlayer", Channels, SampleRate);
            await Task.Delay(200);
            // Start Recording
            await js.InvokeVoidAsync("StartRecordingWav", DeviceId,
                TimeSliceInMilliseconds, DotNetObjectReference.Create(this),
                Channels, SampleRate);
            Recording = true;
        }

        public async Task StopRecording()
        {
            await js.InvokeVoidAsync("StopRecordingWav");
            while (Recording)
            {
                await Task.Delay(100);
            }
        }

        [JSInvokable]
        public async Task RecordingStatus(string status)
        {
            await RecordingStatusChanged.InvokeAsync(status);
            if (status == "Stopped")
            {
                Recording = false;
            }
        }

        [JSInvokable]
        public async Task DataAvailable(string Base64EncodedByteArray)
        {
            // Convert to byte array
            var data = Convert.FromBase64String(Base64EncodedByteArray);
            // remove WAV header
            var rawData = new byte[data.Length - 44];
            Buffer.BlockCopy(data, 44, rawData, 0, rawData.Length);
            var audiobuffer = new AudioBuffer();
            audiobuffer.Data = rawData;
            var l = rawData.Length;

            // find the loudest 16-bit sample
            int volume = 0;
            for (int i = 0; i < l; i += 2)
            {
                volume = Math.Max(volume, Math.Abs(BitConverter.ToInt16(rawData, i)));
            }
            audiobuffer.VolumePercent = volume * 100 / Int16.MaxValue;
            // Notify the caller
            await BufferRecorded.InvokeAsync(audiobuffer);
        }


        [JSInvokable]
        public async Task AvailableDevices(object[] devices)
        {
            // Called by JavaScript when we get the list of devices
            await Task.Delay(1);
            AudioInputDevices.Clear();

            foreach (var device in devices)
            {
                string deviceString = device.ToString();
                var dev = JsonSerializer.Deserialize<BrowserMediaDevice>(deviceString);
                if (dev.kind == "audioinput")
                {
                    if (dev.label.Trim() != "" && dev.deviceId.Trim() != "")
                    {
                        AudioInputDevices.Add(dev);
                    }
                }
                else if (dev.kind == "audiooutput")
                {
                    if (dev.label.Trim() != "" && dev.deviceId.Trim() != "")
                    {
                        AudioOutputDevices.Add(dev);
                    }
                }
                else if (dev.kind == "videoinput")
                {
                    if (dev.label.Trim() != "" && dev.deviceId.Trim() != "")
                    {
                        VideoInputDevices.Add(dev);
                    }
                }
                else
                {
                    var kind = dev.kind;
                }
            }

            if (AudioInputDevices.Count > 0)
            {
                AudioInputDevices = AudioInputDevices.OrderBy(o => o.label).ToList();
            }
            if (AudioOutputDevices.Count > 0)
            {
                AudioOutputDevices = AudioOutputDevices.OrderBy(o => o.label).ToList();
            }
            if (VideoInputDevices.Count > 0)
            {
                VideoInputDevices = VideoInputDevices.OrderBy(o => o.label).ToList();
            }

            await RecordingStatus("Devices");
        }

        public async Task EnumerateDevices()
        {
            await js.InvokeVoidAsync("EnumerateDevices", DotNetObjectReference.Create(this));
        }

        public async Task StopPlayback()
        {
            await js.InvokeVoidAsync("StopPlaying");
        }

        public async Task PlayByteArray(byte[] bytes, bool firstBuffer)
        {
            // You MUST pass firstBuffer as true the first time you call this.
            if (firstBuffer)
                BufferCount = 0;
            // Each buffer has to have a WAV header, so let's add one.
            var mem = new MemoryStream();
            WriteWavHeader(mem, false, Convert.ToUInt16(Channels), 16, SampleRate, bytes.Length / 2);
            mem.Write(bytes, 0, bytes.Length);
            var wavBytes = mem.ToArray();

            // Convert to base 64 string and pass to JavaScript
            var base64String = Convert.ToBase64String(wavBytes);
            await js.InvokeVoidAsync("AddBuffer", base64String);

            // Only start playback after we've passed BuffersBeforePlayback number of buffers.
            BufferCount++;
            if (BufferCount == BuffersBeforePlayback)
            {
                await js.InvokeVoidAsync("StartPlaying");
            }
        }

        protected override async Task OnParametersSetAsync()
        {
            if (AudioInputDevices.Count == 0)
            {
                await EnumerateDevices();
            }
        }

        public void WriteWavHeader(Stream stream, bool isFloatingPoint, ushort channelCount, ushort bitDepth, int sampleRate, int totalSampleCount)
        {
            stream.Position = 0;

            // RIFF header.
            // Chunk ID.
            stream.Write(Encoding.ASCII.GetBytes("RIFF"), 0, 4);

            // Chunk size.
            stream.Write(BitConverter.GetBytes(((bitDepth / 8) * totalSampleCount) + 36), 0, 4);

            // Format.
            stream.Write(Encoding.ASCII.GetBytes("WAVE"), 0, 4);

            // Sub-chunk 1.
            // Sub-chunk 1 ID.
            stream.Write(Encoding.ASCII.GetBytes("fmt "), 0, 4);

            // Sub-chunk 1 size.
            stream.Write(BitConverter.GetBytes(16), 0, 4);

            // Audio format (floating point (3) or PCM (1)). Any other format indicates compression.
            stream.Write(BitConverter.GetBytes((ushort)(isFloatingPoint ? 3 : 1)), 0, 2);

            // Channels.
            stream.Write(BitConverter.GetBytes(channelCount), 0, 2);

            // Sample rate.
            stream.Write(BitConverter.GetBytes(sampleRate), 0, 4);

            // Bytes rate.
            stream.Write(BitConverter.GetBytes(sampleRate * channelCount * (bitDepth / 8)), 0, 4);

            // Block align.
            stream.Write(BitConverter.GetBytes((ushort)channelCount * (bitDepth / 8)), 0, 2);

            // Bits per sample.
            stream.Write(BitConverter.GetBytes(bitDepth), 0, 2);

            // Sub-chunk 2.
            // Sub-chunk 2 ID.
            stream.Write(Encoding.ASCII.GetBytes("data"), 0, 4);

            // Sub-chunk 2 size.
            stream.Write(BitConverter.GetBytes((bitDepth / 8) * totalSampleCount), 0, 4);
        }
    }
}
