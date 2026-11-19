// Voice dictation (Phase 7, Module 8) — local browser Web Speech API ONLY.
//
// PRIVACY: the browser's SpeechRecognition may route audio to an OS/cloud engine
// (e.g. on Chrome). This is therefore OPT-IN and OFF by default. No PHI leaves
// the browser unless the user explicitly starts dictation. The engine is
// pluggable; a self-hosted engine can be wired here later without UI changes.
type Listener = (text: string, isFinal: boolean) => void;

export function dictationSupported(): boolean {
  return typeof window !== 'undefined' &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export class Dictation {
  private rec: any = null;
  private running = false;

  start(onResult: Listener, onEnd?: () => void): boolean {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return false;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';
    rec.onresult = (e: any) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      if (final) onResult(final, true);
      else if (interim) onResult(interim, false);
    };
    rec.onend = () => { this.running = false; onEnd?.(); };
    rec.onerror = () => { this.running = false; onEnd?.(); };
    this.rec = rec;
    this.running = true;
    rec.start();
    return true;
  }

  stop() {
    if (this.rec && this.running) { try { this.rec.stop(); } catch { /* ignore */ } }
    this.running = false;
  }

  get active() { return this.running; }
}
