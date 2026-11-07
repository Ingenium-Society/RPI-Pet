// All visitor-facing text in one place (easy to translate or reword).
export const S = {
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
