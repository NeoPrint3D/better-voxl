use super::*;

#[test]
fn audio_fanout_selects_format_and_skips_disabled_clients() {
    let hub = Hub::new();
    let (tx, mut opus_rx) = mpsc::unbounded_channel();
    let opus = hub.add_client(tx);
    opus.audio.store(true, Ordering::Release);
    let (tx, mut pcm_rx) = mpsc::unbounded_channel();
    let pcm = hub.add_client(tx);
    pcm.audio_pcm.store(true, Ordering::Relaxed);
    pcm.audio.store(true, Ordering::Release);
    let (tx, mut off_rx) = mpsc::unbounded_channel();
    let _off = hub.add_client(tx);
    hub.send_audio(&[10, 20], &[i16::MIN, i16::MAX, 0, -1]);
    let Out::Bin(b) = opus_rx.try_recv().unwrap() else { panic!() };
    assert_eq!(&b[..], &[0x02, 10, 20]);
    let Out::Bin(b) = pcm_rx.try_recv().unwrap() else { panic!() };
    assert_eq!(&b[..], &[0x05, 0, 128, 255, 127, 0, 0, 255, 255]);
    assert!(off_rx.try_recv().is_err());
    pcm.audio.store(false, Ordering::Release);
    hub.send_audio(&[30], &[1, 2]);
    assert!(pcm_rx.try_recv().is_err());
}
