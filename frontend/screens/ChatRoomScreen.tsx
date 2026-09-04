import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
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

import { apiDelete, apiGet, apiPost, randomUuid } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { teacherStyles as shared, teacherColors as colors } from "@/screens/teacher/styles";

const POLL_INTERVAL_MS = 5_000;
const PAGE_SIZE = 100;

interface ChatMessage {
  id: string;
  sender_kind: "user" | "ai" | "system";
  sender: { id: string; display_name: string; role: "student" | "teacher" } | null;
  body_md: string;
  created_at: string;
  pinned_at: string | null;
}

interface MessagesResponse {
  messages: ChatMessage[];
  pinned: ChatMessage[];
  next_before: string | null;
  has_more: boolean;
  empty_reason: "no_messages" | null;
}

export function ChatRoomScreen() {
  const params = useLocalSearchParams<{ channelId?: string; title?: string }>();
  const channelId = params.channelId ?? "";
  const me = useAuthStore((state) => state.me);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pinned, setPinned] = useState<ChatMessage[]>([]);
  const [pinBusyId, setPinBusyId] = useState<string | null>(null);

  const [older, setOlder] = useState<ChatMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const keepPositionRef = useRef(false);
  const readMarkRef = useRef<string | null>(null);

  const visibleMessages = older.length === 0 ? messages : [...older, ...messages];

  const markRead = useCallback(
    (list: ChatMessage[]) => {
      const newest = list[list.length - 1];
      if (channelId === "" || newest === undefined || readMarkRef.current === newest.id) {
        return;
      }

      readMarkRef.current = newest.id;
      apiPost(`/v1/channels/${channelId}/read`).catch(() => undefined);
    },
    [channelId],
  );

  const load = useCallback(
    (silent = false) => {
      if (channelId === "") return;
      apiGet<MessagesResponse>(`/v1/channels/${channelId}/messages`, { limit: PAGE_SIZE })
        .then((response) => {
          setMessages(response.messages);
          setPinned(response.pinned);
          setOlderCursor(response.has_more ? response.next_before : null);
          markRead(response.messages);
        })
        .catch((e: unknown) => {
          if (!silent) {
            setError(errorText(e, "Не удалось загрузить сообщения"));
          }
        })
        .finally(() => {
          if (!silent) setIsLoading(false);
        });
    },
    [channelId, markRead],
  );

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (channelId === "") return undefined;

      const timer = setInterval(() => load(true), POLL_INTERVAL_MS);
      return () => clearInterval(timer);
    }, [channelId, load]),
  );

  const loadOlder = () => {
    if (olderCursor === null || isLoadingOlder) return;

    setIsLoadingOlder(true);
    apiGet<MessagesResponse>(`/v1/channels/${channelId}/messages`, {
      limit: PAGE_SIZE,
      before: olderCursor,
    })
      .then((response) => {
        keepPositionRef.current = true;
        setOlder((current) => [...response.messages, ...current]);
        setOlderCursor(response.has_more ? response.next_before : null);
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось загрузить прошлые сообщения")),
      )
      .finally(() => setIsLoadingOlder(false));
  };

  const isTeacher = me?.role === "teacher";
  const topPinned = pinned[0] ?? null;

  const togglePin = (message: ChatMessage) => {
    if (pinBusyId !== null) return;

    setPinBusyId(message.id);
    setError(null);
    const path = `/v1/channels/${channelId}/messages/${message.id}/pin`;
    const request =
      message.pinned_at === null ? apiPost(path) : apiDelete(path);

    request
      .then(() => load())
      .catch((e: unknown) => setError(errorText(e, "Не удалось изменить закрепление")))
      .finally(() => setPinBusyId(null));
  };

  const send = () => {
    const body = text.trim();
    if (body === "" || isSending) return;

    setIsSending(true);
    setError(null);
    apiPost(`/v1/channels/${channelId}/messages`, { text: body, client_msg_id: randomUuid() })
      .then(() => {
        setText("");
        load();
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось отправить сообщение")),
      )
      .finally(() => setIsSending(false));
  };

  return (
    <SafeAreaView style={shared.safeArea} edges={["top"]}>
      <KeyboardAvoidingView
        style={shared.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={shared.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Назад" onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {params.title ?? "Чат"}
          </Text>
          <View style={styles.headerSpacer} />
        </View>

        {topPinned === null ? null : (
          <View style={styles.pinnedBar}>
            <Ionicons name="pin" size={16} color={colors.navy} />
            <View style={styles.pinnedCopy}>
              <Text style={styles.pinnedLabel}>
                Закреплено{pinned.length > 1 ? ` · ${pinned.length}` : ""}
              </Text>
              <Text style={styles.pinnedText} numberOfLines={2}>
                {topPinned.body_md}
              </Text>
            </View>
            {isTeacher ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Открепить"
                disabled={pinBusyId !== null}
                onPress={() => togglePin(topPinned)}
                style={({ pressed }) => [pressed && shared.pressed]}
              >
                <Ionicons name="close" size={18} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        )}

        <ScrollView
          ref={scrollRef}
          style={shared.scroll}
          contentContainerStyle={styles.messages}
          onContentSizeChange={() => {
            if (keepPositionRef.current) {
              keepPositionRef.current = false;
              return;
            }
            scrollRef.current?.scrollToEnd({ animated: false });
          }}
          showsVerticalScrollIndicator={false}
        >
          {isLoading ? <ActivityIndicator color={colors.blue} /> : null}
          {error ? <Text style={shared.errorText}>{error}</Text> : null}
          {!isLoading && visibleMessages.length === 0 ? (
            <Text style={shared.emptyText}>Сообщений пока нет. Напишите первое.</Text>
          ) : null}

          {olderCursor === null ? null : (
            <Pressable
              accessibilityRole="button"
              disabled={isLoadingOlder}
              onPress={loadOlder}
              style={({ pressed }) => [styles.olderButton, pressed && shared.pressed]}
            >
              <Text style={styles.olderButtonText}>
                {isLoadingOlder ? "Загружаю…" : "Показать более ранние"}
              </Text>
            </Pressable>
          )}

          {visibleMessages.map((message) => {
            const own = message.sender?.id === me?.user_id;
            return (
              <View
                key={message.id}
                style={[styles.bubble, own ? styles.bubbleOwn : styles.bubbleOther]}
              >
                {own ? null : (
                  <Text style={styles.author}>
                    {message.sender?.display_name ?? "Система"}
                    {message.sender?.role === "teacher" ? " · учитель" : ""}
                  </Text>
                )}
                <Text style={[styles.bubbleText, own && styles.bubbleTextOwn]}>
                  {message.body_md}
                </Text>
                {isTeacher ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={message.pinned_at === null ? "Закрепить" : "Открепить"}
                    disabled={pinBusyId !== null}
                    onPress={() => togglePin(message)}
                    style={({ pressed }) => [styles.pinAction, pressed && shared.pressed]}
                  >
                    <Ionicons
                      name={message.pinned_at === null ? "pin-outline" : "pin"}
                      size={14}
                      color={own ? "#dbe6ff" : colors.muted}
                    />
                    <Text style={[styles.pinActionText, own && styles.pinActionTextOwn]}>
                      {message.pinned_at === null ? "Закрепить" : "Откреплено"}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            );
          })}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Сообщение"
            multiline
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Отправить"
            disabled={text.trim() === "" || isSending}
            onPress={send}
            style={({ pressed }) => [
              styles.sendButton,
              (text.trim() === "" || isSending) && shared.disabled,
              pressed && shared.pressed,
            ]}
          >
            <Ionicons name="arrow-up" size={20} color="#ffffff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flex: 1, textAlign: "center", color: colors.text, fontSize: 17, fontWeight: "900" },
  headerSpacer: { width: 26 },
  messages: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, gap: 10 },
  pinnedBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: "#eef4ff",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pinnedCopy: { flex: 1 },
  pinnedLabel: { color: colors.navy, fontSize: 12, fontWeight: "800" },
  pinnedText: { marginTop: 2, color: colors.text, fontSize: 13, lineHeight: 18 },
  pinAction: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  pinActionText: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  pinActionTextOwn: { color: "#dbe6ff" },
  olderButton: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 14 },
  olderButtonText: { color: colors.blue, fontSize: 13, fontWeight: "800" },
  bubble: { maxWidth: "86%", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleOwn: { alignSelf: "flex-end", backgroundColor: colors.navy },
  bubbleOther: {
    alignSelf: "flex-start",
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
  },
  author: { marginBottom: 4, color: colors.muted, fontSize: 12, fontWeight: "800" },
  bubbleText: { color: colors.text, fontSize: 15, lineHeight: 21 },
  bubbleTextOwn: { color: "#ffffff" },
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
});
