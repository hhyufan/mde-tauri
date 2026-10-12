//! Rust 示例：结构体、实现块与所有权。
//!
//! 用于演示悬停提示、跳转定义与 rust-analyzer 的诊断。

#[derive(Debug, Clone)]
pub struct Note {
    pub title: String,
    pub tags: Vec<String>,
}

impl Note {
    pub fn new(title: &str) -> Self {
        Self {
            title: title.to_string(),
            tags: Vec::new(),
        }
    }

    pub fn with_tag(mut self, tag: &str) -> Self {
        self.tags.push(tag.to_string());
        self
    }

    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags.iter().any(|item| item == tag)
    }
}

fn main() {
    let note = Note::new("今天的灵感").with_tag("写作");
    println!("{} -> {:?}", note.title, note.has_tag("写作"));
}
