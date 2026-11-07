import { isOrb } from './game/skin'

// All visitor-facing text in one place (easy to translate or reword).
// BASE is the default skin, byte-for-byte. The orb only overrides the words that treat the
// character like an animal; everything else (including `attract`) is shared.
const BASE = {
  greeting: 'Halo! Tanya apa saja tentang pembuatku.',
  thinking: 'Sedang berpikir...',
  inputLabel: 'Pertanyaan untuk pet',
  placeholder: 'Tulis pertanyaanmu',
  placeholderBusy: 'Pet sedang menjawab...',
  placeholderOffline: 'Menunggu koneksi ke Pi...',
  send: 'Kirim',
  timeout: 'Pi terlalu lama menjawab',
  failedPrefix: 'Pet tidak bisa menjawab',
  bench: 'Benchmark',
  connected: 'terhubung',
  disconnected: 'terputus',
  energy: 'Energi',
  happiness: 'Senang',

  suggestions: 'Coba tanya:',
  suggestionsLabel: 'Pertanyaan yang bisa dicoba',
  careLabel: 'Rawat aku',
  feed: 'Makan',
  play: 'Main',
  sleep: 'Tidur',
  treat: 'Biskuit',
  treatHint: 'Tarik ke aku',
  attract: 'Mau tahu soal klub?',

  // Pre-written, so care actions never wait for the model. These repeat a lot at a booth,
  // which also means the TTS endpoint serves them straight from its cache.
  canned: {
    feed: ['Yum! Enak~', 'Wah, kenyang! Makasih~', 'Nyam nyam!'],
    play: ['Asyik! Main lagi~', 'Hihi, seru banget!', 'Lagi, lagi!'],
    sleep: ['Zzz... *menguap*', 'Ngantuk... *menguap*', 'Mimpi indah... zzz'],
    poke: ['Hihi! Geliii~', 'Wk wk wk!', 'Hihihi~'],
    treat: ['Biskuit! Yum yum~', 'Makasih, enak banget!'],
  },
}

export type Strings = typeof BASE

/** Orb-only wording. Spoken lines stay short and plain because they go through TTS. */
const ORB_OVERRIDES: Partial<Strings> = {
  feed: 'Isi Daya',
  play: 'Main',
  sleep: 'Istirahat',
  treat: 'Percikan',
  canned: {
    ...BASE.canned,
    feed: ['Daya terisi! Segar~', 'Wah, terang lagi! Makasih~', 'Nyala lagi nih!'],
    sleep: ['Istirahat dulu... redup~', 'Mode hemat... zzz', 'Sebentar ya... zzz'],
    treat: ['Percikan! Hangat~', 'Makasih, jadi terang banget!'],
  },
}

export const S: Strings = isOrb ? { ...BASE, ...ORB_OVERRIDES } : BASE
