import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { LessonReader, type LessonBodyBlock } from "@/components/LessonReader";
import { apiGet, apiPost } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";

interface LessonDto {
  id: string;
  title: string;
  topic: { id: string; title: string };
  est_read_minutes: number | null;
  has_material: boolean;
  progress_pct: number;
  material_read: boolean;
  best_check_pct: number | null;
  completed: boolean;
}

interface SubjectDto {
  id: string;
  code: string;
  name: string;
  lessons: LessonDto[];
}

interface LessonLibraryResponse {
  subjects: SubjectDto[];
  empty_reason: "no_subjects" | "no_lessons" | null;
}

interface InboxItem {
  distribution_id: string;
  material: { id: string; title: string; body_blocks: LessonBodyBlock[] | null };
  teacher: { id: string; display_name: string };
  class_name: string | null;
  message_md: string | null;
  due_at: string | null;
  seen_at: string | null;
}

interface InboxResponse {
  items: InboxItem[];
  unread: number;
  empty_reason: "no_items" | null;
}

interface ChatChannelDto {
  id: string;
  kind: "class_chat" | "ai_assistant";
  title: string;
  unread: number;
}

interface ChannelListResponse {
  channels: ChatChannelDto[];
}

const emptyMessages: Record<NonNullable<LessonLibraryResponse["empty_reason"]>, string> = {
  no_subjects: "Сначала выберите предметы в профиле — тогда здесь появятся уроки.",
  no_lessons: "По вашим предметам и классу уроков пока нет. Загляните позже.",
};

export function LessonLibraryScreen() {
  const me = useAuthStore((state) => state.me);
  const [data, setData] = useState<LessonLibraryResponse | null>(null);
  const [activeSubject, setActiveSubject] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [channels, setChannels] = useState<ChatChannelDto[]>([]);
  const [opened, setOpened] = useState<InboxItem | null>(null);

  const load = useCallback(() => {
    setError(null);
    apiGet<LessonLibraryResponse>("/v1/lessons")
      .then(setData)
      .catch((e: unknown) => setError(errorText(e, "Не удалось загрузить уроки")))
      .finally(() => setIsLoading(false));

    apiGet<InboxResponse>("/v1/inbox")
      .then((response) => setInbox(response.items))
      .catch(() => setInbox([]));
    apiGet<ChannelListResponse>("/v1/channels")
      .then((response) =>
        setChannels(response.channels.filter((channel) => channel.kind === "class_chat")),
      )
      .catch(() => setChannels([]));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  const subjects = useMemo(() => data?.subjects ?? [], [data]);
  const current = useMemo(
    () => subjects.find((subject) => subject.code === activeSubject) ?? subjects[0] ?? null,
    [subjects, activeSubject],
  );

  const done = current?.lessons.filter((lesson) => lesson.completed).length ?? 0;
  const total = current?.lessons.length ?? 0;

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.logo}>Tlek</Text>
          <Pressable
            accessibilityLabel="Личный кабинет"
            accessibilityRole="button"
            onPress={() => router.push(routes.personalAccount)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Avatar uri={me?.avatar_url} name={me?.display_name} size={30} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Материалы</Text>
            <Text style={styles.subtitle}>
              Тема, а следом проверка знаний по ней. Проходить можно в любом порядке — от
              дневных задач эта вкладка не зависит.
            </Text>
          </View>

          {isLoading ? <ActivityIndicator color={colors.blue} style={styles.spinner} /> : null}
          {error ? <Text style={styles.emptyText}>{error}</Text> : null}
          {!isLoading && !error && data?.empty_reason ? (
            <Text style={styles.emptyText}>{emptyMessages[data.empty_reason]}</Text>
          ) : null}

          {channels.map((channel) => (
            <Pressable
              key={channel.id}
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/chat-channel",
                  params: { channelId: channel.id, title: channel.title },
                })
              }
              style={({ pressed }) => [styles.inboxCard, pressed && styles.pressed]}
            >
              <Ionicons name="chatbubbles-outline" size={22} color={colors.navy} />
              <View style={styles.inboxCopy}>
                <Text style={styles.inboxTitle}>{channel.title}</Text>
                <Text style={styles.inboxMeta}>
                  Чат класса{channel.unread > 0 ? ` · новых: ${channel.unread}` : ""}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.muted} />
            </Pressable>
          ))}

          {inbox.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>От учителя</Text>
              <View style={styles.inboxList}>
                {inbox.map((item) => (
                  <Pressable
                    key={item.distribution_id}
                    accessibilityRole="button"
                    onPress={() => {
                      setOpened(item);

                      apiPost(`/v1/inbox/${item.distribution_id}/seen`, { opened: true })
                        .then(() => load())
                        .catch(() => undefined);
                    }}
                    style={({ pressed }) => [styles.inboxCard, pressed && styles.pressed]}
                  >
                    <Ionicons
                      name={item.seen_at === null ? "mail-unread-outline" : "mail-open-outline"}
                      size={22}
                      color={item.seen_at === null ? colors.orange : colors.muted}
                    />
                    <View style={styles.inboxCopy}>
                      <Text style={styles.inboxTitle}>{item.material.title}</Text>
                      <Text style={styles.inboxMeta}>
                        {item.teacher.display_name}
                        {item.class_name === null ? "" : ` · ${item.class_name}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}

          {subjects.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
              {subjects.map((subject) => {
                const isActive = subject.code === current?.code;
                return (
                  <Pressable
                    key={subject.id}
                    accessibilityRole="button"
                    onPress={() => setActiveSubject(subject.code)}
                    style={({ pressed }) => [styles.chip, isActive && styles.chipActive, pressed && styles.pressed]}
                  >
                    <Text style={[styles.chipText, isActive && styles.chipTextActive]} numberOfLines={1}>
                      {subject.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {current ? (
            <>
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{current.name.toUpperCase()}</Text>
                <Text style={styles.summaryValue}>
                  {done} из {total} уроков пройдено
                </Text>
                <View style={styles.progressTrack}>
                  <View
                    style={[styles.progressFill, { width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }]}
                  />
                </View>
              </View>

              <View style={styles.lessonList}>
                {current.lessons.map((lesson) => (
                  <LessonCard key={lesson.id} lesson={lesson} />
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        <Modal
          visible={opened !== null}
          animationType="slide"
          onRequestClose={() => setOpened(null)}
        >
          <SafeAreaView style={styles.safeArea} edges={["top", "bottom"]}>
            <View style={styles.header}>
              <Text style={styles.logo} numberOfLines={1}>
                {opened?.material.title ?? ""}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setOpened(null)}>
                <Ionicons name="close" size={26} color={colors.text} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {opened?.message_md ? (
                <Text style={styles.inboxNote}>{opened.message_md}</Text>
              ) : null}
              <LessonReader blocks={opened?.material.body_blocks ?? []} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

function LessonCard({ lesson }: { lesson: LessonDto }) {
  const open = () => {
    if (!lesson.has_material) return;
    router.push({ pathname: "/task-execution-workspace", params: { lessonId: lesson.id } });
  };

  const status = lesson.completed
    ? { label: "Пройден", color: colors.green, background: "#e6f6ec" }
    : lesson.material_read
      ? { label: "Материал прочитан", color: colors.orange, background: "#fdeee7" }
      : { label: "Не начат", color: colors.muted, background: "#eeeeee" };

  return (
    <View style={[styles.lessonCard, lesson.completed && styles.lessonCardDone]}>
      <View style={styles.lessonTopRow}>
        <View style={[styles.statusBadge, { backgroundColor: status.background }]}>
          <Text style={[styles.statusText, { color: status.color }]}>{status.label}</Text>
        </View>
        {lesson.est_read_minutes !== null ? (
          <View style={styles.durationPill}>
            <Ionicons name="time-outline" size={13} color={colors.orange} />
            <Text style={styles.durationText}>{lesson.est_read_minutes} мин</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.lessonTitle}>{lesson.title}</Text>
      <Text style={styles.lessonTopic}>{lesson.topic.title}</Text>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.min(100, Math.round(lesson.progress_pct))}%` }]} />
      </View>
      <Text style={styles.lessonMeta}>
        {Math.round(lesson.progress_pct)}% пройдено
        {lesson.best_check_pct === null ? "" : ` · проверка ${Math.round(lesson.best_check_pct)}%`}
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={!lesson.has_material}
        onPress={open}
        style={({ pressed }) => [
          styles.lessonButton,
          !lesson.has_material && styles.lessonButtonDisabled,
          pressed && lesson.has_material && styles.pressed,
        ]}
      >
        <Text style={styles.lessonButtonText}>
          {!lesson.has_material
            ? "Материал ещё готовится"
            : lesson.completed
              ? "Повторить"
              : lesson.material_read
                ? "К проверке знаний"
                : "Открыть материал"}
        </Text>
        {lesson.has_material ? <Ionicons name="arrow-forward" size={15} color="#ffffff" /> : null}
      </Pressable>
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
  green: "#16a34a",
  orange: "#c84b16",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  header: {
    height: 63,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900", lineHeight: 29 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 24 },
  titleBlock: { marginBottom: 18 },
  title: { color: colors.text, fontSize: 26, fontWeight: "900", lineHeight: 33 },
  subtitle: { marginTop: 6, color: colors.muted, fontSize: 15, lineHeight: 21 },
  spinner: { marginTop: 12 },
  emptyText: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: 16 },
  chipRow: { gap: 8, paddingBottom: 16 },
  chip: {
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
  },
  chipActive: { borderColor: colors.navy, backgroundColor: colors.navy },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  chipTextActive: { color: "#ffffff" },
  summaryCard: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 16,
    marginBottom: 18,
  },
  summaryLabel: { color: colors.muted, fontSize: 12, fontWeight: "900", letterSpacing: 0.4 },
  summaryValue: { marginTop: 4, marginBottom: 12, color: colors.text, fontSize: 19, fontWeight: "900" },
  sectionTitle: { marginTop: 6, marginBottom: 12, color: colors.text, fontSize: 20, fontWeight: "900" },
  inboxList: { gap: 12, marginBottom: 20 },
  inboxCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 14,
    marginBottom: 12,
  },
  inboxCopy: { flex: 1 },
  inboxTitle: { color: colors.text, fontSize: 16, fontWeight: "900" },
  inboxMeta: { marginTop: 3, color: colors.muted, fontSize: 13 },
  inboxNote: { marginBottom: 16, color: colors.muted, fontSize: 15, lineHeight: 22 },
  lessonList: { gap: 14 },
  lessonCard: { borderRadius: 10, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.card, padding: 16 },
  lessonCardDone: { backgroundColor: "#f7f7f7" },
  lessonTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  statusBadge: { borderRadius: 3, paddingHorizontal: 9, paddingVertical: 5 },
  statusText: { fontSize: 11, fontWeight: "900", letterSpacing: 0.3 },
  durationPill: {
    borderRadius: 3,
    backgroundColor: "#fde5d7",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  durationText: { color: colors.orange, fontSize: 12, fontWeight: "800" },
  lessonTitle: { marginTop: 14, color: colors.text, fontSize: 19, fontWeight: "900", lineHeight: 25 },
  lessonTopic: { marginTop: 4, marginBottom: 12, color: colors.muted, fontSize: 14, lineHeight: 20 },
  progressTrack: { height: 7, overflow: "hidden", borderRadius: 4, backgroundColor: "#e8e8e8" },
  progressFill: { height: "100%", borderRadius: 4, backgroundColor: colors.blue },
  lessonMeta: { marginTop: 8, color: colors.muted, fontSize: 13 },
  lessonButton: {
    alignSelf: "flex-start",
    minHeight: 40,
    borderRadius: 7,
    backgroundColor: colors.navy,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 18,
    marginTop: 16,
  },
  lessonButtonDisabled: { backgroundColor: "#9aa1af" },
  lessonButtonText: { color: "#ffffff", fontSize: 14, fontWeight: "900" },
  pressed: { opacity: 0.76 },
});
