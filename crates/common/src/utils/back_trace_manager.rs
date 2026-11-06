#[doc = "禁用backtrace"]
pub fn init_backtrace(enable: bool) {
    unsafe {
        if enable {
            std::env::set_var("RUST_BACKTRACE", "1");
            std::env::set_var("RUST_LIB_BACKTRACE", "1");
        } else {
            std::env::set_var("RUST_BACKTRACE", "0");
            std::env::set_var("RUST_LIB_BACKTRACE", "0");
        }
    }
}
