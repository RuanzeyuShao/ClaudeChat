use serde_json::Value;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::{Duration, Instant},
};

pub fn serve(
    responses: Vec<(u16, &'static str, String)>,
) -> (String, thread::JoinHandle<Vec<Value>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let task = thread::spawn(move || {
        let mut requests = vec![];
        for (status, kind, body) in responses {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "mock API request timed out");
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(e) => panic!("{}", e),
                }
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = vec![];
            let mut buffer = [0; 4096];
            loop {
                let read = socket.read(&mut buffer).unwrap();
                assert!(read > 0);
                bytes.extend_from_slice(&buffer[..read]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let size = headers
                        .lines()
                        .find_map(|line| {
                            line.to_lowercase()
                                .strip_prefix("content-length:")
                                .map(|n| n.trim().parse::<usize>().unwrap())
                        })
                        .unwrap_or(0);
                    if bytes.len() >= end + 4 + size {
                        let value = if size == 0 {
                            Value::Null
                        } else {
                            serde_json::from_slice(&bytes[end + 4..end + 4 + size]).unwrap()
                        };
                        requests.push(value);
                        break;
                    }
                }
            }
            let headers=format!("HTTP/1.1 {} OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",status,kind,body.len());
            socket.write_all(headers.as_bytes()).unwrap();
            socket.write_all(body.as_bytes()).unwrap();
        }
        requests
    });
    (format!("http://{address}/v1"), task)
}
