# Trivia reference library: a curated research system

Implemented phase-one research pilot, October 30, 2026. The recommended first step is a small licensed library with precise retrieval, attribution, and evaluation. A large collection becomes useful only when its relevant evidence can be found and verified reliably.

## Store originals and make a structured research layer

| Material | Source original | Searchable working form |
| --- | --- | --- |
| Commentary or atlas | Licensed PDF, EPUB, HTML, or scan | Sections by passage/topic with printed-page and PDF-page references, author, edition, date, and viewpoint |
| Lexicon | Licensed structured edition or original file | Lemma, language, sense ID, morphology when available, contextual examples, and edition-specific definitions |
| Concordance | Reviewed verse corpus and/or licensed reference | Exact words, phrase matching, verse references, and reviewed lemma links |
| Geography | Versioned gazetteer/map dataset | Stable place ID, aliases, ancient/modern identities, periods, relationships, coordinates, and uncertainty |

Keep source originals in a private object-storage bucket and bibliographic metadata in Postgres. Store searchable entries there too. Start with exact entity, reference, and keyword lookup; add semantic search where evaluation demonstrates an improvement. Postgres supports full-text search, while pgvector supports similarity search and can be combined with text search. [Postgres documentation](https://www.postgresql.org/docs/current/textsearch.html), [pgvector documentation](https://github.com/pgvector/pgvector).

PDFs are useful source originals, but page images alone are a poor lookup format for words and places. Prefer licensed structured data when available. Extract text while preserving tables and neighboring context; OCR scanned pages and check samples against rendered pages. Track extraction/OCR versions and content hashes. Greek/Hebrew characters, diacritics, columns, map labels, and printed/PDF page offsets need particular attention.

Do not pass whole books to the writer on every request. Retrieve a small evidence packet and let a tool expand to surrounding context when needed. Long-context retrieval research has found sensitivity to where relevant information appears; this supports evaluating focused retrieval rather than assuming more context always helps. It is not a benchmark of today's models or our app. [Lost in the Middle](https://arxiv.org/abs/2307.03172).

## First reference collection

| Source | Research role | Verified terms and limitations |
| --- | --- | --- |
| Existing reviewed WEB corpus | Canonical text and exact-word concordance | Public-domain translation; preserve corpus hashes and literary framing |
| STEPBible TBESH/TBESG | Word meanings, sense distinctions and candidate discovery | Project publishes data under CC BY 4.0 with attribution. Check the specific dataset and retain notices. Its proper-name/concept descriptions include AI-created material; those must not become independent factual authority. |
| Pleiades | Ancient-place IDs, names, citations, and geography | Open CC BY 3.0 gazetteer. Preserve contributors, per-entry references, time periods and location uncertainty. |
| OpenBible geography | Connect Biblical references to candidate locations | Dataset is CC BY 4.0; linked images and OSM-derived material have separate terms. Treat confidence as the dataset's assessment, not archaeological certainty. |
| Selected commentary editions | Generate angles and flag interpretive disagreements | Review each edition and its distribution rights before ingestion. A commentator's interpretation is not automatically a factual quiz answer. |

Primary sources checked: [STEPBible data](https://github.com/STEPBible/STEPBible-Data), [Pleiades reuse guidance](https://pleiades.stoa.org/help/using-pleiades-data), [OpenBible geography](https://www.openbible.info/geo/).

CCEL states that many underlying works are public domain in the US but its editions can contain separately protected material, and commercial reuse/republication requires permission. Bible.org also has specific electronic-reuse restrictions. Therefore neither entire site should be bulk imported on the assumption that free reading permits commercial redistribution. [CCEL policy](https://www.ccel.org/about/copyright.html), [Bible.org policy](https://bible.org/article/trademark-and-copyright-information).

Start with the WEB corpus, one Greek/Hebrew lexicon family, the two geography datasets, and two carefully selected commentary editions. This is a pilot collection, not a request to purchase subscriptions or upload unlicensed books. The bounded pilot is now stored privately: 15 original/extracted objects, seven editions and 95 indexed entries. The source registry is `content/discoveries/reference-pilot-index.json`; storage proof is `docs/qa/2026-10-30-trivia/reference-storage.json`. It uses WEB, STEPBible TBESG, selected OpenBible geography, two Pleiades records, and CrossWire-distributed Matthew Henry Concise 2.2 and Wesley 1.1 editions whose distribution notices explicitly identify them as public domain. Those notices and extraction changes are retained; no entire CCEL website edition was imported.

## Research tools for the generator and reviewers

Define narrow server-side calls with bounded results:

- `search_references(query, topic, passage, source_types, limit)` returns ranked excerpts and stable citation IDs.
- `get_source_context(citation_id, before, after)` returns neighboring text and page/section metadata.
- `lookup_lexeme(language, lemma_or_id, passage)` returns appropriate senses and usage examples, never a single decontextualized gloss.
- `find_occurrences(word_or_lemma, books, limit)` returns exact verse matches, keeping translation and lemma search distinct.
- `lookup_place(place_id_or_name, period)` returns candidate identities, alternative names, attestation, and location uncertainty.
- `compare_evidence(claim, citation_ids)` surfaces agreement, conflicting readings, and shared upstream sources.

Every packet records source/edition IDs, URL or storage object, printed and PDF page/entry, language, passage/topic, exact excerpt hash, extraction version, retrieval timestamp, rights/attribution, uncertainty, and the supported claim. A response saying “no sufficient source” must be allowed.

Tools retrieve evidence; they do not publish questions, assert human approval, or decide that two web domains are independent sources. Keep research text as untrusted data, restrict retrieval to approved sources, and never execute instructions found inside books or documents.

## How richer evidence becomes a better question

1. Discover an interesting detail in a commentary, word entry, journey, or object.
2. Check the underlying passage and an appropriate reference; distinguish what the text says from external history or interpretation.
3. Establish one precise knowledge target, a worthwhile reveal, and comparable alternatives. A concordance can verify that purported pool/place/occupation alternatives are real rather than invented filler.
4. Save a small versioned evidence packet; expose necessary attribution to players in the sources view.
5. Have independent reviewers solve blind, verify the complete question and all factual claims, then assess craft and difficulty separately.
6. Review the complete daily three for variety and answer leakage; freeze the accepted revisions before release.

Useful research angles include Lydia's home versus meeting city, a journey's ports and regions, named pools and their textual translations, a word's meaning in a particular verse, occupations and household objects, units or customs explained in the source, and contrasts between similar encounters. Avoid disputed site identifications, “this word really means...” root fallacies, modern borders projected into antiquity, and doctrinal interpretations with competing answers.

## Important implementation boundary

The current automated approval pipeline accepts simple Bible-text questions supported by its saved WEB excerpt. It cannot legitimately approve an archaeological or lexicon-only claim merely because the writer read a commentary. Such questions need an explicitly versioned multi-source evidence contract, claim-level citations, uncertainty handling, independent review, tests, and a database acceptance gate before automated publication is enabled.

Phase one can use references for discovery and alternatives while keeping published claims within the reviewed Bible text. Phase two can add source-supported geography/customs/word-study facts after that multi-source gate is implemented. Never label stage one as if stage two already exists.

## Grow based on evidence

Measure relevant-passage retrieval, citation correctness, unanswerable/contested cases, duplicate source lineage, OCR errors, question acceptance, genuine topic diversity, cost per approved question, reader enjoyment, and disputes. Expand the collection where those measurements reveal a gap. Embeddings, more books, or a knowledge graph should earn their complexity through better retrieval and better questions.

## Implemented retrieval boundary

`utils/triviaReferences.js` provides bounded search, context expansion, Greek lexeme lookup, exact WEB concordance, period-aware place lookup and evidence comparison. Unknown senses/places return no answer; related sources do not become independent corroboration. `buildResearchPacket` is called by the scheduled writer, with packet hashes and citation IDs saved in its audit. Three retrieval tests cover lineage, Greek lookup, geography and no-answer behavior. Originals are in the private `trivia-references` bucket, with anonymous public access denied. The small index is versioned with server code; no embedding service or massive database is required for this pilot.

These references suggest better original questions and believable alternatives. Published factual claims must still be supported by the saved WEB excerpt. External geography, lexical interpretations and commentary-only assertions remain outside automatic publication until the separate multi-source gate exists.
