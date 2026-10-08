use anyhow::{anyhow, Result};

/// Buffer bytes, not lossy strings: UTF-8 code points and SSE delimiters can cross packets.
#[derive(Default)]
pub struct Decoder {
    bytes: Vec<u8>,
}
impl Decoder {
    pub fn feed(&mut self, chunk: &[u8]) -> Result<Vec<String>> {
        self.bytes.extend_from_slice(chunk);
        let mut frames = Vec::new();
        loop {
            let lf = self
                .bytes
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|p| (p, 2));
            let crlf = self
                .bytes
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .map(|p| (p, 4));
            let delimiter = match (lf, crlf) {
                (Some(a), Some(b)) => Some(if a.0 < b.0 { a } else { b }),
                (a, b) => a.or(b),
            };
            let Some((end, size)) = delimiter else { break };
            let text = std::str::from_utf8(&self.bytes[..end])
                .map_err(|_| anyhow!("API 流包含无效 UTF-8"))?;
            let data = text
                .lines()
                .filter_map(|line| {
                    line.strip_prefix("data:")
                        .map(|s| s.strip_prefix(' ').unwrap_or(s))
                })
                .collect::<Vec<_>>()
                .join("\n");
            if !data.is_empty() {
                frames.push(data);
            }
            self.bytes.drain(..end + size);
        }
        if self.bytes.len() > 4 * 1024 * 1024 {
            return Err(anyhow!("API 流事件超过 4 MB"));
        }
        Ok(frames)
    }
    pub fn finish(&mut self) -> Result<Vec<String>> {
        if self.bytes.is_empty() {
            return Ok(vec![]);
        }
        self.feed(b"\n\n")
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fragmented_unicode_crlf_and_multiline() {
        let mut decoder = Decoder::default();
        let input = "data: {\"text\":\"中文\"}\r\n\r\n: keepalive\n\ndata: line1\ndata: line2\n\n"
            .as_bytes();
        let mut events = vec![];
        for byte in input {
            events.extend(decoder.feed(&[*byte]).unwrap())
        }
        assert_eq!(events, vec!["{\"text\":\"中文\"}", "line1\nline2"]);
        assert!(decoder.finish().unwrap().is_empty());
    }
    #[test]
    fn final_event_without_blank_line() {
        let mut d = Decoder::default();
        assert!(d.feed(b"data: [DONE]").unwrap().is_empty());
        assert_eq!(d.finish().unwrap(), vec!["[DONE]"]);
    }
}
