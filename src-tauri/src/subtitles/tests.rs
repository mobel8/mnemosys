//! Unit tests for the subtitle parser + importer (Vague 11).

use super::parser::{parse, strip_formatting, SubtitleCue};
use super::{import_cues, SubtitleImportResult, SubtitleMode, TRANSLATE_PLACEHOLDER};
use crate::db::{Database, NoteTemplate};

#[test]
fn parse_srt_basic() {
    let srt = "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n\
               2\n00:00:05,500 --> 00:00:07,000\nSecond line\n";
    let cues = parse(srt, false);
    assert_eq!(cues.len(), 2);
    assert_eq!(
        cues[0],
        SubtitleCue {
            index: 1,
            start_ms: 1000,
            end_ms: 4000,
            text: "Hello world".to_string(),
        }
    );
    // 5.5s → 5500ms; verifies the comma-millis path.
    assert_eq!(cues[1].start_ms, 5500);
    assert_eq!(cues[1].text, "Second line");
}

#[test]
fn parse_vtt_basic() {
    let vtt = "WEBVTT\n\n\
               00:00:01.000 --> 00:00:04.000\nBonjour\n\n\
               NOTE this is a comment\n\n\
               00:00:05.000 --> 00:00:06.000 align:start position:10%\nAu revoir\n";
    let cues = parse(vtt, true);
    // The WEBVTT header and the NOTE block must be skipped.
    assert_eq!(cues.len(), 2);
    assert_eq!(cues[0].text, "Bonjour");
    assert_eq!(cues[0].start_ms, 1000);
    // Cue settings after the end timestamp are ignored.
    assert_eq!(cues[1].text, "Au revoir");
    assert_eq!(cues[1].start_ms, 5000);
}

#[test]
fn strip_formatting_tags() {
    assert_eq!(strip_formatting("<i>Hello</i> <b>world</b>"), "Hello world");
    assert_eq!(
        strip_formatting("<font color=\"#fff\">Coloured</font> text"),
        "Coloured text"
    );
    // SSA/ASS override blocks.
    assert_eq!(strip_formatting("{\\an8}Top text"), "Top text");
    // VTT inline timestamp tags.
    assert_eq!(strip_formatting("Karaoke<00:00:01.500>line"), "Karaokeline");
    // Whitespace runs left behind are collapsed.
    assert_eq!(strip_formatting("a   b\t\tc"), "a b c");
}

#[test]
fn parse_handles_bom_and_crlf() {
    // Leading UTF-8 BOM + Windows CRLF line endings.
    let srt = "\u{feff}1\r\n00:00:01,000 --> 00:00:02,000\r\nLine one\r\nLine two\r\n\r\n";
    let cues = parse(srt, false);
    assert_eq!(cues.len(), 1);
    // Multi-line cue text is merged with a single space.
    assert_eq!(cues[0].text, "Line one Line two");
}

#[test]
fn parse_drops_empty_and_whitespace_cues() {
    let srt = "1\n00:00:01,000 --> 00:00:02,000\n\n\n\
               2\n00:00:03,000 --> 00:00:04,000\n<i></i>\n";
    // Both cues have no real text after stripping → dropped by the parser.
    let cues = parse(srt, false);
    assert!(cues.is_empty());
}

#[test]
fn parse_vtt_short_timestamp() {
    // VTT permits MM:SS.mmm without an hour field.
    let vtt = "WEBVTT\n\n01:30.000 --> 01:32.000\nShort form\n";
    let cues = parse(vtt, true);
    assert_eq!(cues.len(), 1);
    assert_eq!(cues[0].start_ms, 90_000); // 1m30s
    assert_eq!(cues[0].end_ms, 92_000);
}

#[test]
fn import_creates_notes() {
    let db = Database::for_test();
    let deck_id = {
        let conn = db.lock();
        db.decks(&conn)
            .create("Films", None, "#3b82f6", 0.9, None, None, None)
            .unwrap()
            .id
    };

    let cues = vec![
        SubtitleCue {
            index: 1,
            start_ms: 0,
            end_ms: 1000,
            text: "Je suis content".to_string(),
        },
        SubtitleCue {
            index: 2,
            start_ms: 1000,
            end_ms: 2000,
            text: "\u{266a} la la la".to_string(), // music cue → filtered
        },
    ];

    let result = import_cues(&db, deck_id, &cues, SubtitleMode::Sentence, "subtitles").unwrap();
    assert_eq!(
        result,
        SubtitleImportResult {
            cues_parsed: 2,
            notes_created: 1,
            skipped_empty: 1,
        }
    );

    // The surviving note is a Basic note tagged "subtitles" with the
    // translation placeholder pre-filled.
    let conn = db.lock();
    let notes = db.notes(&conn).list_in_deck(deck_id, 10, 0).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].template, NoteTemplate::Basic);
    assert_eq!(notes[0].tags, vec!["subtitles".to_string()]);
    assert_eq!(notes[0].fields["front"], "Je suis content");
    assert_eq!(notes[0].fields["back"], TRANSLATE_PLACEHOLDER);
}

#[test]
fn import_cloze_mode_blanks_longest_word() {
    let db = Database::for_test();
    let deck_id = {
        let conn = db.lock();
        db.decks(&conn)
            .create("Cloze", None, "#3b82f6", 0.9, None, None, None)
            .unwrap()
            .id
    };

    let cues = vec![SubtitleCue {
        index: 1,
        start_ms: 0,
        end_ms: 1000,
        text: "the extraordinary cat".to_string(),
    }];

    let result = import_cues(&db, deck_id, &cues, SubtitleMode::Cloze, "subtitles").unwrap();
    assert_eq!(result.notes_created, 1);

    let conn = db.lock();
    let notes = db.notes(&conn).list_in_deck(deck_id, 10, 0).unwrap();
    assert_eq!(notes[0].template, NoteTemplate::Cloze);
    // "extraordinary" is the longest word and must be the c1 deletion.
    assert_eq!(
        notes[0].fields["text"].as_str().unwrap(),
        "the {{c1::extraordinary}} cat"
    );
}

#[test]
fn import_unknown_deck_errors() {
    let db = Database::for_test();
    let cues = vec![SubtitleCue {
        index: 1,
        start_ms: 0,
        end_ms: 1,
        text: "x".to_string(),
    }];
    // Deck 999 doesn't exist — must surface as an error, not silently skip.
    let err = import_cues(&db, 999, &cues, SubtitleMode::Sentence, "subtitles");
    assert!(err.is_err());
}

#[test]
fn mode_parse_rejects_garbage() {
    assert_eq!(SubtitleMode::parse("sentence").unwrap(), SubtitleMode::Sentence);
    assert_eq!(SubtitleMode::parse("cloze").unwrap(), SubtitleMode::Cloze);
    assert!(SubtitleMode::parse("bogus").is_err());
}
