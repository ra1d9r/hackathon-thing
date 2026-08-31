import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, View } from "react-native";

export type LessonSpanMark = "bold" | "italic" | "underline" | "strike";

export interface LessonSpan {
  text: string;
  marks?: LessonSpanMark[];
}

export interface LessonHeadingBlock {
  type: "heading";
  level: 1 | 2 | 3;
  spans: LessonSpan[];
}

export interface LessonParagraphBlock {
  type: "paragraph";
  spans: LessonSpan[];
}

export interface LessonQuoteBlock {
  type: "quote";
  spans: LessonSpan[];
}

export interface LessonListBlock {
  type: "list";
  items: { spans?: LessonSpan[] }[];
}

export interface LessonFormulaBlock {
  type: "formula";
  formula?: string;
  latex?: string;
  spans?: LessonSpan[];
}

export interface LessonCalloutBlock {
  type: "callout";
  tone?: "info" | "key" | "warning";
  title?: string;
  spans?: LessonSpan[];
  blocks?: LessonBodyBlock[];
}

export type LessonBodyBlock =
  | LessonHeadingBlock
  | LessonParagraphBlock
  | LessonQuoteBlock
  | LessonListBlock
  | LessonFormulaBlock
  | LessonCalloutBlock;

interface LessonReaderProps {
  blocks: LessonBodyBlock[];
  emptyText?: string;
}

export function LessonReader({ blocks, emptyText = "Материал ещё готовится." }: LessonReaderProps) {
  if (blocks.length === 0) {
    return <Text style={styles.paragraph}>{emptyText}</Text>;
  }

  return (
    <View style={styles.reader}>
      {blocks.map((block, index) => (
        <LessonBlock key={`${block.type}-${index}`} block={block} />
      ))}
    </View>
  );
}

function LessonBlock({ block }: { block: LessonBodyBlock }) {
  switch (block.type) {
    case "heading":
      return <LessonHeading block={block} />;
    case "paragraph":
      return <LessonParagraph spans={block.spans} />;
    case "quote":
      return <KeyIdeaCallout spans={block.spans} />;
    case "list":
      return <LessonList items={block.items} />;
    case "formula":
      return <FormulaBlock formula={block.formula ?? block.latex ?? spansToText(block.spans ?? [])} />;
    case "callout":
      return <CalloutBlock block={block} />;
  }
}

function LessonHeading({ block }: { block: LessonHeadingBlock }) {
  return (
    <Text
      style={[
        styles.heading,
        block.level === 1 && styles.headingOne,
        block.level === 2 && styles.headingTwo,
        block.level === 3 && styles.headingThree,
      ]}
    >
      <InlineSpans spans={block.spans} />
    </Text>
  );
}

function LessonParagraph({ spans }: { spans: LessonSpan[] }) {
  return (
    <Text style={styles.paragraph}>
      <InlineSpans spans={spans} />
    </Text>
  );
}

function LessonList({ items }: { items: LessonListBlock["items"] }) {
  return (
    <View style={styles.list}>
      {items.map((item, index) => (
        <View key={`${spansToText(item.spans ?? []).slice(0, 16)}-${index}`} style={styles.listItem}>
          <View style={styles.bullet} />
          <Text style={styles.listText}>
            <InlineSpans spans={item.spans ?? []} />
          </Text>
        </View>
      ))}
    </View>
  );
}

function FormulaBlock({ formula }: { formula: string }) {
  if (formula.trim().length === 0) return null;

  return (
    <View style={styles.formulaBlock}>
      <Text style={styles.formulaText}>{formula}</Text>
    </View>
  );
}

function KeyIdeaCallout({ spans }: { spans: LessonSpan[] }) {
  return (
    <View style={[styles.callout, styles.calloutInfo]}>
      <View style={styles.calloutIcon}>
        <Ionicons name="bulb-outline" size={18} color="#0f766e" />
      </View>
      <Text style={styles.calloutText}>
        <InlineSpans spans={spans} />
      </Text>
    </View>
  );
}

function CalloutBlock({ block }: { block: LessonCalloutBlock }) {
  const tone = block.tone ?? "info";
  const isWarning = tone === "warning";
  const isKey = tone === "key";
  const icon = isWarning ? "alert-circle-outline" : isKey ? "sparkles-outline" : "information-circle-outline";
  const iconColor = isWarning ? "#b42318" : isKey ? "#0057d9" : "#0f766e";

  return (
    <View style={[styles.callout, isWarning ? styles.calloutWarning : isKey ? styles.calloutKey : styles.calloutInfo]}>
      <View style={styles.calloutIcon}>
        <Ionicons name={icon} size={18} color={iconColor} />
      </View>
      <View style={styles.calloutBody}>
        {block.title ? <Text style={styles.calloutTitle}>{block.title}</Text> : null}
        {block.spans ? (
          <Text style={styles.calloutText}>
            <InlineSpans spans={block.spans} />
          </Text>
        ) : null}
        {block.blocks ? (
          <View style={styles.nestedBlocks}>
            {block.blocks.map((child, index) => (
              <LessonBlock key={`${child.type}-${index}`} block={child} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function InlineSpans({ spans }: { spans: LessonSpan[] }) {
  return (
    <>
      {spans.map((span, index) => (
        <Text key={`${span.text.slice(0, 12)}-${index}`} style={spanStyles(span.marks ?? [])}>
          {span.text}
        </Text>
      ))}
    </>
  );
}

function spansToText(spans: LessonSpan[]): string {
  return spans.map((span) => span.text).join("");
}

function spanStyles(marks: LessonSpanMark[]) {
  return [
    marks.includes("bold") && styles.bold,
    marks.includes("italic") && styles.italic,
    marks.includes("underline") && styles.underline,
    marks.includes("strike") && styles.strike,
  ];
}

const colors = {
  text: "#202124",
  muted: "#555b66",
  border: "#c5cede",
  blue: "#245cf2",
};

const styles = StyleSheet.create({
  reader: {
    gap: 14,
  },
  heading: {
    color: colors.text,
    fontWeight: "900",
  },
  headingOne: {
    fontSize: 26,
    lineHeight: 33,
    marginBottom: 2,
  },
  headingTwo: {
    fontSize: 22,
    lineHeight: 29,
    marginTop: 4,
  },
  headingThree: {
    fontSize: 18,
    lineHeight: 25,
    marginTop: 2,
  },
  paragraph: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 25,
  },
  list: {
    gap: 10,
    paddingVertical: 2,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  bullet: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.blue,
    marginTop: 9,
  },
  listText: {
    flex: 1,
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
  },
  formulaBlock: {
    borderRadius: 10,
    borderColor: "#d6e2ff",
    borderWidth: 1,
    backgroundColor: "#f4f8ff",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  formulaText: {
    color: colors.text,
    fontSize: 20,
    lineHeight: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  callout: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 14,
  },
  calloutInfo: {
    borderColor: "#b7ded9",
    backgroundColor: "#effaf8",
  },
  calloutKey: {
    borderColor: "#c8d8ff",
    backgroundColor: "#f2f6ff",
  },
  calloutWarning: {
    borderColor: "#f4c7c1",
    backgroundColor: "#fff4f2",
  },
  calloutIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  calloutBody: {
    flex: 1,
    gap: 8,
  },
  calloutTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: "900",
    lineHeight: 20,
  },
  calloutText: {
    flex: 1,
    color: colors.muted,
    fontSize: 15,
    lineHeight: 22,
  },
  nestedBlocks: {
    gap: 10,
  },
  bold: {
    fontWeight: "900",
    color: colors.text,
  },
  italic: {
    fontStyle: "italic",
  },
  underline: {
    textDecorationLine: "underline",
  },
  strike: {
    textDecorationLine: "line-through",
  },
});
