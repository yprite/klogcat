pub struct LineSplitter {
    buffer: Vec<u8>,
}
impl LineSplitter {
    pub fn new() -> Self {
        Self { buffer: Vec::new() }
    }
    pub fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.buffer.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(pos) = self.buffer.iter().position(|b| *b == b'\n') {
            let mut line: Vec<u8> = self.buffer.drain(..=pos).collect();
            line.pop();
            out.push(Self::decode(line));
        }
        out
    }
    pub fn flush(&mut self) -> Option<String> {
        if self.buffer.is_empty() {
            None
        } else {
            Some(Self::decode(std::mem::take(&mut self.buffer)))
        }
    }
    fn decode(mut bytes: Vec<u8>) -> String {
        if bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
        String::from_utf8(bytes)
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).to_string())
    }
}
impl Default for LineSplitter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn partial_line_across_chunks() {
        let mut s = LineSplitter::new();
        assert!(s.push(b"hel").is_empty());
        assert_eq!(s.push(b"lo\n"), vec!["hello"]);
    }
    #[test]
    fn multiple_lines_in_one_chunk() {
        let mut s = LineSplitter::new();
        assert_eq!(s.push(b"a\nb\n"), vec!["a", "b"]);
    }
    #[test]
    fn crlf_emits_lines_without_trailing_cr() {
        let mut s = LineSplitter::new();
        assert_eq!(s.push(b"a\r\nb\r\n"), vec!["a", "b"]);
    }
    #[test]
    fn partial_line_without_trailing_newline_is_flushed_on_process_exit() {
        let mut s = LineSplitter::new();
        s.push(b"tail");
        assert_eq!(s.flush(), Some("tail".into()));
    }
    #[test]
    fn utf8_multibyte_boundary_split() {
        let mut s = LineSplitter::new();
        let bytes = "😀\n".as_bytes();
        assert!(s.push(&bytes[..2]).is_empty());
        assert_eq!(s.push(&bytes[2..]), vec!["😀"]);
    }
    #[test]
    fn invalid_utf8_in_one_completed_line_uses_lossy_decode_only_for_that_line() {
        let mut s = LineSplitter::new();
        assert_eq!(s.push(&[0xff, b'\n', b'a', b'\n']), vec!["�", "a"]);
    }
}
