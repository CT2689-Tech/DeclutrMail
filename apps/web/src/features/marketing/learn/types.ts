export interface LearnStep {
  readonly name: string;
  readonly text: string;
}

export interface LearnCallout {
  readonly title: string;
  readonly body: string;
  readonly tone?: 'info' | 'warning' | 'truth';
}

export interface LearnSection {
  readonly id: string;
  readonly title: string;
  readonly paragraphs: readonly string[];
  readonly bullets?: readonly string[];
  readonly steps?: readonly LearnStep[];
  readonly callout?: LearnCallout;
}

export interface SyntheticRow {
  readonly sender: string;
  readonly detail: string;
  readonly action: string;
  readonly result: string;
}

export interface SyntheticExample {
  /** Must always make the non-production nature of the example explicit. */
  readonly label: 'Illustrative example — synthetic data';
  readonly caption: string;
  readonly rows: readonly SyntheticRow[];
}

export interface RelatedLink {
  readonly href: string;
  readonly label: string;
  readonly description: string;
}

export interface LearnArticle {
  readonly slug: string;
  readonly path: string;
  readonly kind: 'How-to guide' | 'Direct answer' | 'Launch essay';
  readonly title: string;
  readonly description: string;
  readonly eyebrow: string;
  readonly intro: string;
  readonly quickAnswer?: string;
  readonly readingMinutes: number;
  readonly sections: readonly LearnSection[];
  readonly example?: SyntheticExample;
  readonly sources?: readonly RelatedLink[];
  readonly related: readonly RelatedLink[];
}

export interface FaqEntry {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly link?: RelatedLink;
}

export interface ChangelogEvidence {
  readonly commit: string;
  readonly pullRequest: number;
  readonly summary: string;
}

export interface ChangelogEntry {
  readonly id: string;
  readonly date: string;
  readonly title: string;
  readonly summary: string;
  readonly added: readonly string[];
  readonly improved: readonly string[];
  readonly fixed: readonly string[];
  readonly evidence: readonly ChangelogEvidence[];
}
