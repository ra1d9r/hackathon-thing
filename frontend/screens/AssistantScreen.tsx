import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { LessonReader, type LessonBodyBlock } from "@/components/LessonReader";
import { apiGet, apiPost, randomUuid, waitForJob } from "@/services/api";
import { errorText } from "@/services/errors";

interface SuggestedAction {
  kind: "open_lesson" | "start_task" | "open_roadmap";
  ref_id: string;
  label: string;
}

interface AssistantMessage {
  id: string;
  sender_kind: "user" | "ai" | "system";
  body_md: string;
  body_blocks: LessonBodyBlock[];
  refusal_reason: "off_topic" | "unsafe" | "out_of_grade_scope" | "none";
  referenced_topics: { id: string; title: string }[];
  suggested_actions: SuggestedAction[];
  source: "ai" | "fallback" | "moderation" | null;
  created_at: string;
}

interface ChannelResponse {
  channel: { id: string; title: string; unread: number };
  quota: { daily_limit: number; used_today: number; remaining: number };
}

interface MessagesResponse {
  messages: AssistantMessage[];
  next_before: string | null;
  has_more: boolean;
  empty_reason: "no_messages" | null;
}

interface PostResponse {
  message: AssistantMessage;
  reply: AssistantMessage | null;
  job: { id: string; poll_url: string } | null;
}

const REFUSAL_LABELS: Record<Exclude<AssistantMessage["refusal_reason"], "none">, string> = {
  off_topic: "Не по учёбе",
  unsafe: "Небезопасная тема",
  out_of_grade_scope: "Выше вашей программы",
};

const REPLY_TIMEOUT_MS = 120_000;

export function AssistantScreen() {
  const params = useLocalSearchParams<{ topicId?: string }>();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [quota, setQuota] = useState<ChannelResponse["quota"] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const load = useCallback(() => {
    apiGet<ChannelResponse>("/v1/assistant/channel")
      .then((response) => setQuota(response.quota))
      .catch(() => undefined);

    apiGet<MessagesResponse>("/v1/assistant/messages", { limit: 100 })
      .then((response) => setMessages(response.messages))
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось загрузить переписку")),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
    apiPost("/v1/assistant/read").catch(() => undefined);
  }, [load]);

  const ask = async () => {
    const question = text.trim();
    if (question === "" || isThinking) return;

    setText("");
    setError(null);
    setIsThinking(true);

    try {
      const posted = await apiPost<PostResponse>("/v1/assistant/messages", {
        text: question,
        client_msg_id: randomUuid(),

        ...(params.topicId === undefined
          ? {}
          : { context_hint: { topic_id: params.topicId } }),
      });

      if (posted.job !== null) {
        await waitForJob(posted.job.id, { totalTimeoutMs: REPLY_TIMEOUT_MS, waitMs: 25_000 });
      }
      load();
    } catch (e) {
      setError(errorText(e, "Не удалось отправить вопрос"));
    } finally {
      setIsThinking(false);
    }
  };

  const runAction = (action: SuggestedAction) => {
    if (action.kind === "open_roadmap") {
      router.push("/(tabs)/progress");
      return;
    }

    router.push("/(tabs)/learning");
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.logo}>Ассистент</Text>
            {quota === null ? null : (
              <Text style={styles.quota}>
                Осталось вопросов сегодня: {quota.remaining} из {quota.daily_limit}
              </Text>
            )}
          </View>
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? <ActivityIndicator color={colors.blue} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}

          {!isLoading && messages.length === 0 ? (
            <View style={styles.intro}>
              <Ionicons name="sparkles-outline" size={26} color={colors.blue} />
              <Text style={styles.introTitle}>Спросите о чём угодно по учёбе</Text>
              <Text style={styles.introText}>
                Ассистент знает ваш класс, выбранные предметы, слабые темы и сегодняшний план —
                поэтому объясняет с учётом того, что вы уже проходили.
              </Text>
              <View style={styles.hints}>
                {[
                  "Объясни теорему Виета на примере",
                  "Какие темы у меня сейчас слабее всего?",
                  "С чего начать подготовку сегодня?",
                ].map((hint) => (
                  <Pressable
                    key={hint}
                    accessibilityRole="button"
                    onPress={() => setText(hint)}
                    style={({ pressed }) => [styles.hint, pressed && styles.pressed]}
                  >
                    <Text style={styles.hintText}>{hint}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {messages.map((message) =>
            message.sender_kind === "user" ? (
              <View key={message.id} style={[styles.bubble, styles.bubbleOwn]}>
                <Text style={styles.bubbleOwnText}>{message.body_md}</Text>
              </View>
            ) : (
              <AssistantBubble key={message.id} message={message} onAction={runAction} />
            ),
          )}

          {isThinking ? (
            <View style={[styles.bubble, styles.bubbleOther, styles.thinking]}>
              <ActivityIndicator color={colors.blue} size="small" />
              <Text style={styles.thinkingText}>Ассистент думает…</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Вопрос по учёбе"
            multiline
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Спросить"
            disabled={text.trim() === "" || isThinking}
            onPress={() => void ask()}
            style={({ pressed }) => [
              styles.sendButton,
              (text.trim() === "" || isThinking) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="arrow-up" size={20} color="#ffffff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function AssistantBubble({
  message,
  onAction,
}: {
  message: AssistantMessage;
  onAction: (action: SuggestedAction) => void;
}) {
  const refused = message.refusal_reason !== "none";

  return (
    <View style={[styles.bubble, styles.bubbleOther, refused && styles.bubbleRefused]}>
      {refused ? (
        <View style={styles.refusalBadge}>
          <Ionicons name="information-circle-outline" size={14} color="#b42318" />
          <Text style={styles.refusalText}>
            {REFUSAL_LABELS[message.refusal_reason as keyof typeof REFUSAL_LABELS]}
          </Text>
        </View>
      ) : null}

      <LessonReader blocks={message.body_blocks} emptyText={message.body_md} />

      {message.referenced_topics.length > 0 ? (
        <Text style={styles.topics}>
          Темы: {message.referenced_topics.map((topic) => topic.title).join(", ")}
        </Text>
      ) : null}

      {message.suggested_actions.length > 0 ? (
        <View style={styles.actions}>
          {message.suggested_actions.map((action) => (
            <Pressable
              key={`${action.kind}-${action.ref_id}`}
              accessibilityRole="button"
              onPress={() => onAction(action)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <Text style={styles.actionText}>{action.label}</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.navy} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {}
      {message.source === "fallback" ? (
        <Text style={styles.fallbackNote}>Ответ собран без модели: она была недоступна.</Text>
      ) : null}
    </View>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  text: "#202124",
  muted: "#555b66",
  border: "#c5cede",
  blue: "#0057d9",
  navy: "#274779",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    minHeight: 63,
    justifyContent: "center",
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  logo: { color: colors.blue, fontSize: 22, fontWeight: "900", lineHeight: 27 },
  quota: { marginTop: 2, color: colors.muted, fontSize: 12 },
  scroll: { flex: 1 },
  messages: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 12 },
  error: { color: "#c31717", fontSize: 14, lineHeight: 20 },

  intro: { alignItems: "center", paddingHorizontal: 8, paddingTop: 24, gap: 8 },
  introTitle: { color: colors.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  introText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center" },
  hints: { marginTop: 12, gap: 8, alignSelf: "stretch" },
  hint: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  hintText: { color: colors.navy, fontSize: 14, fontWeight: "700" },

  bubble: { maxWidth: "92%", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  bubbleOwn: { alignSelf: "flex-end", backgroundColor: colors.navy, maxWidth: "86%" },
  bubbleOwnText: { color: "#ffffff", fontSize: 15, lineHeight: 21 },
  bubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  bubbleRefused: { borderColor: "#f3c6c1", backgroundColor: "#fdf6f5" },
  refusalBadge: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 },
  refusalText: { color: "#b42318", fontSize: 12, fontWeight: "900" },
  topics: { marginTop: 10, color: colors.muted, fontSize: 13 },
  actions: { marginTop: 12, gap: 8 },
  action: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  actionText: { flex: 1, color: colors.navy, fontSize: 14, fontWeight: "800" },
  fallbackNote: { marginTop: 10, color: "#c84b16", fontSize: 12, fontWeight: "700" },
  thinking: { flexDirection: "row", alignItems: "center", gap: 10 },
  thinkingText: { color: colors.muted, fontSize: 14 },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
  },
  disabled: { opacity: 0.46 },
  pressed: { opacity: 0.76 },
});
