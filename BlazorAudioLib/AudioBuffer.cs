using System;
using System.Collections.Generic;
using System.Text;

namespace BlazorAudioLib
{
    public class AudioBuffer
    {
        public byte[] Data { get; set; }
        public int VolumePercent { get; set; }
    }
}
