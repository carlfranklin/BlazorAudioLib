using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;

namespace BlazorAudioLib
{
    public class BrowserMediaDevice
    {
        public string deviceId { get; set; }
        public string kind { get; set; }
        public string label { get; set; }
        public string groupId { get; set; }
    }
}
