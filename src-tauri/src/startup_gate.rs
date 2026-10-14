use std::time::{Duration, Instant};

const MIN_SPLASH_TIME: Duration = Duration::from_millis(350);

#[derive(Default)]
pub(crate) struct StartupGate {
    pub(crate) main_ready: bool,
    pub(crate) splash_shown: Option<Instant>,
    pub(crate) scheduled: bool,
    pub(crate) finished: bool,
}

impl StartupGate {
    pub(crate) fn schedule(&mut self, now: Instant, force: bool) -> Option<Duration> {
        if self.scheduled || self.finished || (!force && !self.main_ready) {
            return None;
        }
        let delay = match self.splash_shown {
            Some(shown) if !force => MIN_SPLASH_TIME.saturating_sub(now.duration_since(shown)),
            None if !force => return None,
            _ => Duration::ZERO,
        };
        self.scheduled = true;
        Some(delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn waits_for_both_pages_and_only_holds_the_splash_briefly() {
        let now = Instant::now();
        let mut state = StartupGate {
            main_ready: true,
            ..Default::default()
        };
        assert_eq!(state.schedule(now, false), None);
        state.splash_shown = Some(now);
        assert_eq!(state.schedule(now, false), Some(MIN_SPLASH_TIME));
        assert_eq!(state.schedule(now, true), None);
    }

    #[test]
    fn slow_initialization_adds_no_extra_animation_delay() {
        let now = Instant::now();
        let mut state = StartupGate {
            main_ready: true,
            splash_shown: Some(now - Duration::from_secs(2)),
            ..Default::default()
        };
        assert_eq!(state.schedule(now, false), Some(Duration::ZERO));
    }

    #[test]
    fn a_visible_splash_waits_for_main_readiness() {
        let now = Instant::now();
        let mut state = StartupGate {
            splash_shown: Some(now),
            ..Default::default()
        };
        assert_eq!(state.schedule(now, false), None);
        state.main_ready = true;
        assert_eq!(
            state.schedule(now + Duration::from_millis(200), false),
            Some(Duration::from_millis(150))
        );
    }

    #[test]
    fn watchdog_can_recover_a_missing_page_without_reopening_a_finished_startup() {
        let mut state = StartupGate::default();
        assert_eq!(state.schedule(Instant::now(), true), Some(Duration::ZERO));
        state.finished = true;
        state.scheduled = false;
        assert_eq!(state.schedule(Instant::now(), true), None);
    }
}
