use time::format_description::BorrowedFormatItem;
use tracing_subscriber::{
    EnvFilter,
    fmt::{
        time::OffsetTime,
        writer::{MakeWriter, MakeWriterExt},
    },
};

fn time_formatter() -> OffsetTime<Vec<BorrowedFormatItem<'static>>> {
    OffsetTime::new(
        time::UtcOffset::current_local_offset().unwrap_or_else(|_| time::UtcOffset::UTC),
        time::format_description::parse_borrowed::<1>(
            "[year]-[month padding:zero]-[day padding:zero] [hour]:[minute]:[second]",
        )
        .expect("Cataplum"),
    )
}

#[doc = "初始化daily滚动日志"]
pub fn init_daily_rolling(
    directory: impl AsRef<std::path::Path>,
    file_name_prefix: impl AsRef<std::path::Path>,
    stdout: bool,
) {
    let logfile = tracing_appender::rolling::daily(directory, file_name_prefix);
    if stdout {
        init_with_writer(logfile.and(std::io::stdout.with_max_level(tracing::Level::TRACE)));
    } else {
        init_with_writer(logfile);
    }
}

pub fn init_with_file(log_filepath: impl AsRef<std::path::Path>, stdout: bool) {
    let log_filepath = log_filepath.as_ref();

    if let Some(parent) = log_filepath.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).unwrap_or_else(|error| {
                panic!(
                    "failed to create log directory {}: {error}",
                    parent.display()
                )
            });
        }
    }

    let logfile = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_filepath)
        .unwrap_or_else(|error| {
            panic!(
                "failed to open log file {}: {error}",
                log_filepath.display()
            )
        });

    if stdout {
        init_with_writer(logfile.and(std::io::stdout.with_max_level(tracing::Level::TRACE)));
    } else {
        init_with_writer(logfile);
    }
}

fn init_with_writer<W>(writer: W)
where
    W: for<'writer> MakeWriter<'writer> + Send + Sync + 'static,
{
    let env_filter = EnvFilter::new("info")
        .add_directive("dust_dds=warn".parse().unwrap())
        .add_directive("dust_dds_gen=warn".parse().unwrap())
        .add_directive("egui=warn".parse().unwrap())
        .add_directive("eframe=warn".parse().unwrap())
        .add_directive("salvo=warn".parse().unwrap())
        .add_directive("remotefs_ssh=off".parse().unwrap())
        .add_directive("lightspeed_scheduler=warn".parse().unwrap())
        .add_directive("wgpu=warn".parse().unwrap())
        .add_directive("wgpu_core=warn".parse().unwrap())
        .add_directive("wgpu_hal=warn".parse().unwrap())
        .add_directive("naga=warn".parse().unwrap());
    tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_timer(time_formatter())
        .with_file(true)
        .with_line_number(true)
        .with_target(false)
        .with_thread_ids(false)
        .with_thread_names(false)
        .with_writer(writer)
        .with_ansi(false)
        .init();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_init_daily_rolling() {
        init_daily_rolling("nvme/log", "ellipse", false);
        log::info!("aaaa");
    }

    #[test]
    fn test_init_with_file() {
        init_with_file("nvme/log/123.log", false);
        for i in 0..100 {
            log::info!("message-{i}");
        }
    }
}
