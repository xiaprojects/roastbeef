
// Shared instance that can be used across screens
if(window.gMeterBuzzerPlayer === undefined || window.gMeterBuzzerPlayer === null){
window.gMeterBuzzerPlayer = new AudioSinusoidPlayer();
}

AudioSinusoidPlayer.prototype = {
    constructor: AudioSinusoidPlayer
};

function AudioSinusoidPlayer() {
    console.log("G-Meter Buzzer");
    // Instance Variables
    this.beepContext = null; // Audio Player to be instantiated only when the user tap on the screen
    this.beepModel = "square" // Audio Wave Form
    this.synthByFreq = {}; // Cache of the Sinusoid buffer
    this.volume = 0;
    this.seconds = 0.20;
    this.waitFor = 300;
    this.quietRange = 0.3; // G: 0.7<-G->1.3 will be quiet
    this.max = 5;
    this.min = -2;
    this.maxHz = 1320;
    this.minHz = 220;
    this.lastPlayTime = new Date();



    // Local Methods
    // Generate Sinusoid with fade in and fade out to avoid the pop
    function prepareSynth(sampleRate, tone, seconds, volume, waveAt) {
        var arr = [];
        var volumeRampDuration = 0.002
        var volumeRamp = 0;
        for (var i = 0; i < sampleRate * volumeRampDuration; i++) {
            volumeRamp = (i / (sampleRate * volumeRampDuration)) * volume;
            arr[i] = waveAt(sampleRate, i, tone) * volumeRamp;
        }
        for (var i = (sampleRate * volumeRampDuration); i < sampleRate * (seconds - volumeRampDuration); i++) {
            arr[i] = waveAt(sampleRate, i, tone) * volume;
        }
        for (var i = sampleRate * (seconds - volumeRampDuration); i < sampleRate * (seconds); i++) {
            volumeRamp = ((sampleRate * (seconds) - i) / (sampleRate * volumeRampDuration)) * volume;
            arr[i] = waveAt(sampleRate, i, tone) * volumeRamp;
        }
        return arr;
    }

    // Play the audio
    function playSound(context, buf,audioSource) {
        var buffer = context.createBuffer(1, buf.length, context.sampleRate)
        buffer.copyToChannel(buf, 0)
        
        audioSource.buffer = buffer;
        audioSource.connect(context.destination);
        audioSource.start(0);
        return true;
    }

    // Sine
    function sineWaveAt(sampleRate, sampleNumber, tone) {
        var sampleFreq = sampleRate / tone
        return Math.sin(sampleNumber / (sampleFreq / (Math.PI * 2)))
    }

    // Triangle
    function trianWaveAt(sampleRate, sampleNumber, tone) {
        var sampleFreq = sampleRate / (tone)
        var trian = (sampleNumber%sampleFreq)/sampleFreq;
        return trian;
    }

    // Square
    function squarWaveAt(sampleRate, sampleNumber, tone) {
        var sampleFreq = sampleRate / (tone)
        var squar = (sampleNumber%sampleFreq)>(sampleFreq/2.0)?0.9:0.1;
        return squar;
    }

    // Public Methods
    this.setGLimits= function(neg,pos) {
        this.max = pos;
        this.min = neg;
        return this;
    }
    this.setVolumeTo= function (v100) {
        this.synthByFreq = {};
        this.volume = v100;
        return this;
    }
    this.beepWithGLoadFactor = function(value){
        // Quiet Range
        const pRange = (1+this.quietRange);
        const nRange = (1-this.quietRange);
        if(value>nRange&&value<pRange){
            return false;
        }
        // Evaluate the Danger
        const progressionPositive = (value - pRange)/(this.max - pRange);
        const progressionNegative = (value - nRange)/(this.min - nRange);

        const progression = value>1.0?progressionPositive:progressionNegative;
        var scale = this.maxHz-this.minHz;
        var frequency = (progression * scale) + this.minHz;
        return this.playSinToObject(this, frequency, this.volume, this.seconds);
    }

    this.playSinToObject = function(audiPlayerObject, frequency, volume100, seconds) {
        if(volume100==0){
            return false;
        }
        if(audiPlayerObject.beepContext == null)
        {
            audiPlayerObject.beepContext = new AudioContext();
            
        }
        else {
            if(new Date() - audiPlayerObject.lastPlayTime < this.waitFor){
                return false;
            }
            else
            {
                audiPlayerObject.lastPlayTime = new Date();
            }
        }
        console.log(frequency)


        if(audiPlayerObject.audioSource == null)
        {
            audiPlayerObject.audioSource = audiPlayerObject.beepContext.createBufferSource();
        }
        else {
            audiPlayerObject.audioSource.stop();
            audiPlayerObject.audioSource = audiPlayerObject.beepContext.createBufferSource();
        }
        
        if (audiPlayerObject.synthByFreq.hasOwnProperty(frequency) == false) {
            var waveAt = sineWaveAt;
            switch (audiPlayerObject.beepModel) {
                case "square":
                    waveAt = squarWaveAt;
                    break;
                case "triangle":
                    waveAt = trianWaveAt;
                    break;
            }
            sampleRate = audiPlayerObject.beepContext.sampleRate;
            var arr = prepareSynth(sampleRate, frequency, seconds, volume100 / 100.0, waveAt);
            var buf = new Float32Array(arr.length)
            for (var i = 0; i < arr.length; i++) buf[i] = arr[i]
            audiPlayerObject.synthByFreq[frequency] = buf;

        };
        return playSound(audiPlayerObject.beepContext, audiPlayerObject.synthByFreq[frequency],audiPlayerObject.audioSource);
    }

    this.beepTest = function(){
        var G = 1.0;
        var numberOfTestSamples = 4;
        var stepper = (this.max-G-this.quietRange)/numberOfTestSamples;
        for(var step = 0; step < numberOfTestSamples; step++){
            window.setTimeout((step)=>{
                this.beepWithGLoadFactor(((step+1) * stepper)+G+this.quietRange);
            },350*step,step);    
        }
    }
}