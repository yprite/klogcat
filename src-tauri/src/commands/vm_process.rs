use crate::error::CommandError;
use std::{
    io::Read,
    process::{Command, Output},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

pub(crate) fn run_shell_with_timeout(
    command: &str,
    timeout: Duration,
) -> Result<Output, CommandError> {
    let mut child = spawn_shell_child(command)?;
    let pid = child.id();
    let stdout_rx = read_child_pipe(child.stdout.take(), "stdout")?;
    let stderr_rx = read_child_pipe(child.stderr.take(), "stderr")?;
    wait_for_shell_child(
        &mut child,
        pid,
        stdout_rx,
        stderr_rx,
        Instant::now() + timeout,
    )
}

fn spawn_shell_child(command: &str) -> Result<std::process::Child, CommandError> {
    let mut child_command = Command::new("sh");
    child_command
        .arg("-lc")
        .arg(command)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    #[cfg(unix)]
    {
        child_command.process_group(0);
    }
    child_command.spawn().map_err(|e| {
        CommandError::new(
            "vm_discovery_spawn_failed",
            "failed to spawn VM discovery command",
        )
        .with_details(e.to_string())
    })
}

fn read_child_pipe<T: Read + Send + 'static>(
    pipe: Option<T>,
    name: &str,
) -> Result<mpsc::Receiver<std::io::Result<Vec<u8>>>, CommandError> {
    let pipe = pipe.ok_or_else(|| {
        CommandError::new(
            "vm_discovery_failed",
            format!("failed to capture VM discovery {name}"),
        )
    })?;
    Ok(read_pipe(pipe))
}

fn wait_for_shell_child(
    child: &mut std::process::Child,
    pid: u32,
    stdout_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    stderr_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    deadline: Instant,
) -> Result<Output, CommandError> {
    loop {
        if let Some(status) = try_shell_child_status(child, pid)? {
            return collect_shell_output(status, stdout_rx, stderr_rx);
        }
        if Instant::now() >= deadline {
            return timeout_shell_child(child, pid);
        }
        thread::sleep(Duration::from_millis(25));
    }
}

fn try_shell_child_status(
    child: &mut std::process::Child,
    pid: u32,
) -> Result<Option<std::process::ExitStatus>, CommandError> {
    child.try_wait().map_err(|e| {
        kill_process_group(pid);
        let _ = child.kill();
        CommandError::new(
            "vm_discovery_failed",
            "failed to wait for VM discovery command",
        )
        .with_details(e.to_string())
    })
}

fn collect_shell_output(
    status: std::process::ExitStatus,
    stdout_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    stderr_rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
) -> Result<Output, CommandError> {
    Ok(Output {
        status,
        stdout: collect_pipe(stdout_rx, "stdout")?,
        stderr: collect_pipe(stderr_rx, "stderr")?,
    })
}

fn timeout_shell_child(child: &mut std::process::Child, pid: u32) -> Result<Output, CommandError> {
    kill_process_group(pid);
    let _ = child.kill();
    let _ = child.wait();
    Err(
        CommandError::new("vm_discovery_timeout", "VM discovery timed out")
            .with_details("Timed out while running Consul catalog command through bastion"),
    )
}

fn read_pipe<R: Read + Send + 'static>(mut reader: R) -> mpsc::Receiver<std::io::Result<Vec<u8>>> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut buffer = Vec::new();
        let result = reader.read_to_end(&mut buffer).map(|_| buffer);
        let _ = tx.send(result);
    });
    rx
}

fn collect_pipe(
    rx: mpsc::Receiver<std::io::Result<Vec<u8>>>,
    name: &str,
) -> Result<Vec<u8>, CommandError> {
    match rx.recv_timeout(Duration::from_secs(1)) {
        Ok(Ok(buffer)) => Ok(buffer),
        Ok(Err(e)) => Err(CommandError::new(
            "vm_discovery_failed",
            format!("failed to read VM discovery {name}"),
        )
        .with_details(e.to_string())),
        Err(e) => Err(CommandError::new(
            "vm_discovery_failed",
            format!("failed to collect VM discovery {name}"),
        )
        .with_details(e.to_string())),
    }
}

fn kill_process_group(pid: u32) {
    #[cfg(unix)]
    {
        let _ = unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
    }
}
