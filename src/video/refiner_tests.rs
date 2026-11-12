use super::*;

fn ready() -> Refiner {
    let mut r = Refiner::new(6, 2);
    r.epoch = Instant::now() - Duration::from_secs(1);
    r.last_refine = Instant::now() - Duration::from_secs(1);
    r
}

#[test]
fn no_due_blocks_preserves_pending_and_check_time() {
    let mut r = ready();
    let last = r.last_refine;
    assert!(r.due().is_none());
    r.mark_all();
    assert!(r.due().is_none());
    assert!(r.pending.iter().all(|&p| p));
    assert_eq!(r.last_refine, last);
}

#[test]
fn only_still_pending_blocks_are_refined() {
    let mut r = ready();
    r.pending = vec![false, true, true, false, false, true];
    r.changed_ms[2] = r.now(); // Still moving, not yet eligible.
    let (map, band) = r.due().unwrap();
    assert_eq!(map, vec![0, 1, 0, 0, 0, 1]);
    assert_eq!((band.y0, band.y1), (0, 48));
    assert_eq!(r.pending, vec![false, false, true, false, false, false]);
    assert!(r.due().is_none()); // Preserve the refinement rate limit.
}

#[test]
fn refinement_band_only_spans_selected_rows() {
    let mut r = ready();
    r.pending[2] = true;
    let (map, band) = r.due().unwrap();
    assert_eq!(map, vec![0, 0, 1, 0, 0, 0]);
    assert_eq!((band.y0, band.y1), (16, 32));
    r.last_refine = Instant::now() - Duration::from_secs(1);
    assert!(r.due().is_none());
}
