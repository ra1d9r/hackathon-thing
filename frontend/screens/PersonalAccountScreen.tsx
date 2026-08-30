import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { formatGrade, SELECTABLE_GRADES } from "@/constants/grades";
import { useProfileStats, type SubjectMastery } from "@/hooks/useProfileStats";
import { guessMimeType, updateProfile, uploadAvatar } from "@/services/profile";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";

type AccountTab = "main" | "stats";

const goalLabels: Record<string, string> = {
  ent: "ЕНТ",
  nis: "НИШ",
  subjects: "Предметы",
};

export function PersonalAccountScreen() {
  const me = useAuthStore((state) => state.me);
  const logout = useAuthStore((state) => state.logout);
  const [activeTab, setActiveTab] = useState<AccountTab>("main");
  const stats = useProfileStats();

  if (!me) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.blue} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Назад"
            accessibilityRole="button"
            onPress={() => (router.canGoBack() ? router.back() : router.replace(routes.tabsRoot))}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.logo}>Tlek</Text>
          <View style={styles.backButton} />
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ProfileCard />
          <SegmentedTabs activeTab={activeTab} onChange={setActiveTab} />
          {activeTab === "main" ? <MainTab stats={stats} /> : <StatsTab stats={stats} />}

          <Pressable
            accessibilityRole="button"
            onPress={() => void logout()}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.logoutText}>Выйти из аккаунта</Text>
          </Pressable>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function ProfileCard() {
  const me = useAuthStore((state) => state.me);
  const setMe = useAuthStore((state) => state.setMe);

  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(me?.display_name ?? "");
  const [grade, setGrade] = useState<number | null>(me?.grade ?? null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  if (!me) return null;

  const isStudent = me.role === "student";

  const startEditing = () => {
    setName(me.display_name);
    setGrade(me.grade);
    setMessage(null);
    setIsEditing(true);
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setMessage("Имя не может быть пустым");
      return;
    }

    setIsSaving(true);
    setMessage(null);
    try {
      const payload: { display_name?: string; grade?: number } = {};
      if (trimmed !== me.display_name) payload.display_name = trimmed;
      if (isStudent && grade !== null && grade !== me.grade) payload.grade = grade;

      
      if (Object.keys(payload).length === 0) {
        setIsEditing(false);
        return;
      }

      setMe(await updateProfile(payload));
      setIsEditing(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить");
    } finally {
      setIsSaving(false);
    }
  };

  const changeAvatar = async () => {
    setMessage(null);

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      const text = "Нужен доступ к галерее, чтобы выбрать фото";
      if (Platform.OS === "web") setMessage(text);
      else Alert.alert("Tlek", text);
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (picked.canceled || picked.assets.length === 0) return;

    const asset = picked.assets[0];
    const mimeType = guessMimeType(asset.uri, asset.mimeType);
    if (mimeType === null) {
      setMessage("Поддерживаются только JPEG, PNG и WebP");
      return;
    }

    setIsUploading(true);
    try {
      setMe(await uploadAvatar(asset.uri, mimeType));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить аватар");
    } finally {
      setIsUploading(false);
    }
  };

  const copyId = async () => {
    await Clipboard.setStringAsync(me.public_id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <View style={styles.profileCard}>
      <Pressable
        accessibilityLabel="Изменить аватар"
        accessibilityRole="button"
        disabled={isUploading}
        onPress={() => void changeAvatar()}
        style={({ pressed }) => [styles.avatarWrap, pressed && styles.pressed]}
      >
        <Avatar uri={me.avatar_url} name={me.display_name} size={84} />
        <View style={styles.avatarBadge}>
          {isUploading ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Ionicons name="camera" size={15} color="#ffffff" />
          )}
        </View>
      </Pressable>

      <View style={styles.profileInfo}>
        {isEditing ? (
          <>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Имя"
              maxLength={64}
              style={styles.nameInput}
            />
            {isStudent ? (
              <View style={styles.gradeRow}>
                {SELECTABLE_GRADES.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: grade === value }}
                    onPress={() => setGrade(value)}
                    style={[styles.gradeChip, grade === value && styles.gradeChipActive]}
                  >
                    <Text style={[styles.gradeChipText, grade === value && styles.gradeChipTextActive]}>
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.editActions}>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => void save()}
                style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <Text style={styles.saveButtonText}>Сохранить</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={isSaving}
                onPress={() => setIsEditing(false)}
                style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              >
                <Text style={styles.cancelButtonText}>Отмена</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <>
            <View style={styles.nameRow}>
              <Text style={styles.userName} numberOfLines={2}>
                {me.display_name}
              </Text>
              <Pressable
                accessibilityLabel="Изменить профиль"
                accessibilityRole="button"
                onPress={startEditing}
                style={({ pressed }) => [styles.editButton, pressed && styles.pressed]}
              >
                <Ionicons name="create-outline" size={18} color={colors.blue} />
              </Pressable>
            </View>

            <View style={styles.badgeRow}>
              <View style={styles.gradeBadge}>
                <Text style={styles.gradeBadgeText}>{isStudent ? formatGrade(me.grade) : "Учитель"}</Text>
              </View>
              {me.student?.goal ? (
                <View style={styles.goalBadge}>
                  <Text style={styles.goalBadgeText}>{goalLabels[me.student.goal] ?? me.student.goal}</Text>
                </View>
              ) : null}
            </View>

            <Pressable
              accessibilityLabel="Скопировать ID"
              accessibilityRole="button"
              onPress={() => void copyId()}
              style={({ pressed }) => [styles.idBadge, pressed && styles.pressed]}
            >
              <View style={styles.idTextBlock}>
                <Text style={styles.idLabel}>ID пользователя</Text>
                <Text style={styles.idValue} numberOfLines={1}>
                  {me.public_id}
                </Text>
              </View>
              <Ionicons
                name={copied ? "checkmark-circle" : "copy-outline"}
                size={22}
                color={copied ? colors.success : colors.muted}
              />
            </Pressable>
          </>
        )}

        {message ? <Text style={styles.message}>{message}</Text> : null}
      </View>
    </View>
  );
}

function SegmentedTabs({ activeTab, onChange }: { activeTab: AccountTab; onChange: (tab: AccountTab) => void }) {
  return (
    <View style={styles.tabs}>
      <TabButton label="Главное" active={activeTab === "main"} onPress={() => onChange("main")} />
      <TabButton label="Статистика" active={activeTab === "stats"} onPress={() => onChange("stats")} />
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={styles.tabButton}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
    </Pressable>
  );
}

type Stats = ReturnType<typeof useProfileStats>;

function MainTab({ stats }: { stats: Stats }) {
  const me = useAuthStore((state) => state.me);
  const { overview, isLoading, error, reload } = stats;

  const subjects = me?.student?.subjects ?? [];

  return (
    <View style={styles.tabContent}>
      <View style={styles.metricRow}>
        <MetricCard
          label="СЕРИЯ"
          value={overview ? `${overview.streak_days}` : "—"}
          unit="дней подряд"
          icon="flame"
          color="#c84b16"
          background="#fdeee7"
        />
        <MetricCard
          label="ЗАДАНИЙ"
          value={overview ? `${overview.questions_answered}` : "—"}
          unit="решено"
          icon="checkmark-done-outline"
          color="#1f66ff"
          background="#edf3ff"
        />
        <MetricCard
          label="ВРЕМЯ"
          value={overview ? `${Math.round(overview.study_hours * 10) / 10}` : "—"}
          unit="часов учёбы"
          icon="time-outline"
          color="#2f7d4f"
          background="#e9f6ee"
        />
        <MetricCard
          label="ПОМОЩЬ ИИ"
          value={overview ? `${overview.ai_usage_count}` : "—"}
          unit="раз"
          icon="hardware-chip-outline"
          color="#666a72"
          background="#f0f0f0"
        />
      </View>

      {subjects.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Мои предметы</Text>
          <View style={styles.chipList}>
            {subjects.map((subject) => (
              <View key={subject.code} style={[styles.subjectChip, subject.is_profile && styles.subjectChipProfile]}>
                <Text style={[styles.subjectChipText, subject.is_profile && styles.subjectChipTextProfile]}>
                  {subject.name}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Изучено</Text>
        <StateBlock
          isLoading={isLoading}
          error={error}
          onRetry={reload}
          isEmpty={(overview?.subjects.length ?? 0) === 0}
          emptyText="Пройдите первые задания — прогресс по предметам появится здесь."
        >
          <View style={styles.progressList}>
            {(overview?.subjects ?? []).map((subject) => (
              <SubjectProgressRow key={subject.code} subject={subject} />
            ))}
          </View>
        </StateBlock>
      </View>
    </View>
  );
}

function SubjectProgressRow({ subject }: { subject: SubjectMastery }) {
  const value = Math.max(0, Math.min(100, Math.round(subject.mastery_pct)));
  const isWeak = value < 50;

  return (
    <View>
      <View style={styles.progressRowHeader}>
        <Text style={styles.progressLabel} numberOfLines={1}>
          {subject.name}
        </Text>
        {isWeak ? (
          <View style={styles.importantBadge}>
            <Text style={styles.importantText}>ВАЖНО</Text>
          </View>
        ) : null}
        <Text style={styles.progressValue}>{value}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${value}%`, backgroundColor: isWeak ? "#c91f1f" : "#2b63f1" }]} />
      </View>
      <Text style={styles.progressMeta}>
        Тем освоено: {subject.topics_mastered} из {subject.topics_total}
      </Text>
    </View>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  unit: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  background: string;
}

function MetricCard({ label, value, unit, icon, color, background }: MetricCardProps) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIconBox, { backgroundColor: background }]}>
        <Ionicons name={icon} size={20} color={color} />
      </View>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricUnit}>{unit}</Text>
    </View>
  );
}

function StatsTab({ stats }: { stats: Stats }) {
  const { width } = useWindowDimensions();
  const { overview, history, isLoading, error, reload } = stats;
  const chartWidth = Math.max(200, Math.min(width - 96, 300));

  const chartData = (history?.points ?? []).slice(-8).map((point) => ({
    value: Math.round(point.value * 10) / 10,
    label: new Date(point.at).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
  }));

  const predicted = overview?.predicted_score ?? null;

  return (
    <View style={styles.tabContent}>
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Ориентировочный балл</Text>
        <StateBlock
          isLoading={isLoading}
          error={error}
          onRetry={reload}
          isEmpty={predicted === null}
          emptyText="Балл появится после первых проверенных работ."
        >
          {predicted ? (
            <View style={styles.scoreBlock}>
              <View style={styles.scoreRow}>
                <Text style={styles.scoreValue}>{Math.round(predicted.value * 10) / 10}</Text>
                <Text style={styles.scoreMax}>/ {predicted.max}</Text>
                {predicted.delta_vs_previous !== null ? (
                  <View
                    style={[styles.deltaBadge, predicted.delta_vs_previous >= 0 ? styles.deltaUp : styles.deltaDown]}
                  >
                    <Ionicons
                      name={predicted.delta_vs_previous >= 0 ? "trending-up" : "trending-down"}
                      size={14}
                      color={predicted.delta_vs_previous >= 0 ? colors.success : colors.danger}
                    />
                    <Text
                      style={[
                        styles.deltaText,
                        predicted.delta_vs_previous >= 0 ? styles.deltaTextUp : styles.deltaTextDown,
                      ]}
                    >
                      {predicted.delta_vs_previous >= 0 ? "+" : ""}
                      {Math.round(predicted.delta_vs_previous * 10) / 10}
                    </Text>
                  </View>
                ) : null}
              </View>
              {predicted.five_grade !== null ? (
                <Text style={styles.scoreHint}>Это примерно «{predicted.five_grade}» по пятибалльной шкале</Text>
              ) : null}
              <Text style={styles.scoreSource}>
                {predicted.source === "ai" ? "Оценка ИИ по вашим ответам" : "Предварительный расчёт"}
              </Text>
            </View>
          ) : null}
        </StateBlock>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Динамика баллов</Text>
        <StateBlock
          isLoading={isLoading}
          error={error}
          onRetry={reload}
          isEmpty={chartData.length < 2}
          emptyText="Нужно хотя бы два замера — пройдите ещё одну работу."
        >
          <View style={styles.chartBox}>
            <LineChart
              data={chartData}
              color="#3B82F6"
              thickness={3}
              dataPointsColor="#3B82F6"
              dataPointsRadius={5}
              maxValue={history?.max ?? 10}
              noOfSections={4}
              hideRules
              initialSpacing={20}
              spacing={44}
              curved={false}
              width={chartWidth}
              height={190}
              backgroundColor="transparent"
              xAxisColor="#d8dee9"
              yAxisColor="transparent"
              yAxisTextStyle={styles.axisText}
              xAxisLabelTextStyle={styles.axisText}
            />
          </View>
        </StateBlock>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Сводка</Text>
        <StateBlock isLoading={isLoading} error={error} onRetry={reload} isEmpty={overview === null}>
          <View style={styles.summaryList}>
            <SummaryRow label="Вопросов отвечено" value={`${overview?.questions_answered ?? 0}`} />
            <SummaryRow label="Работ проверено" value={`${overview?.attempts_graded ?? 0}`} />
            <SummaryRow label="Часов за обучением" value={`${Math.round((overview?.study_hours ?? 0) * 10) / 10}`} />
            <SummaryRow label="Дней подряд" value={`${overview?.streak_days ?? 0}`} />
            {overview?.class_name ? <SummaryRow label="Класс" value={overview.class_name} /> : null}
          </View>
        </StateBlock>
      </View>
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function StateBlock({
  isLoading,
  error,
  onRetry,
  isEmpty,
  emptyText = "Пока нет данных.",
  children,
}: {
  isLoading: boolean;
  error: string | null;
  onRetry: () => void;
  isEmpty: boolean;
  emptyText?: string;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return <ActivityIndicator color={colors.blue} style={styles.stateSpacing} />;
  }

  if (error) {
    return (
      <View style={styles.stateSpacing}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
        >
          <Text style={styles.retryText}>Повторить</Text>
        </Pressable>
      </View>
    );
  }

  if (isEmpty) {
    return <Text style={[styles.emptyText, styles.stateSpacing]}>{emptyText}</Text>;
  }

  return <>{children}</>;
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  profile: "#f4f2f2",
  text: "#202124",
  muted: "#4f5362",
  border: "#c5cede",
  blue: "#0057d9",
  navy: "#274779",
  danger: "#c31717",
  success: "#1c7a45",
  tabActive: "#45a8b0",
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 64 },

  header: {
    width: "100%",
    height: 63,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    paddingHorizontal: 8,
  },
  backButton: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  logo: { color: colors.blue, fontSize: 24, fontWeight: "900" },

  profileCard: {
    marginTop: 24,
    borderRadius: 12,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.profile,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
    padding: 20,
  },
  avatarWrap: { position: "relative" },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.navy,
    borderWidth: 2,
    borderColor: colors.profile,
  },
  profileInfo: { flex: 1, gap: 10 },
  nameRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  userName: { flex: 1, color: colors.text, fontSize: 20, fontWeight: "900", lineHeight: 25 },
  editButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  gradeBadge: { borderRadius: 6, backgroundColor: "#dfe8ff", paddingHorizontal: 10, paddingVertical: 5 },
  gradeBadgeText: { color: "#163462", fontSize: 12, fontWeight: "800" },
  goalBadge: { borderRadius: 6, backgroundColor: "#e4f3ec", paddingHorizontal: 10, paddingVertical: 5 },
  goalBadgeText: { color: "#1c7a45", fontSize: 12, fontWeight: "800" },
  idBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  idTextBlock: { flex: 1 },
  idLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  idValue: { color: colors.text, fontSize: 14, fontWeight: "800" },

  nameInput: {
    minHeight: 44,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 12,
    fontSize: 16,
    color: colors.text,
  },
  gradeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  gradeChip: {
    minWidth: 40,
    minHeight: 36,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  gradeChipActive: { borderColor: colors.blue, backgroundColor: "#eef4ff" },
  gradeChipText: { color: colors.text, fontSize: 14, fontWeight: "800" },
  gradeChipTextActive: { color: colors.blue },
  editActions: { flexDirection: "row", gap: 8 },
  saveButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
  cancelButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: { color: colors.text, fontSize: 15, fontWeight: "800" },
  message: { color: colors.danger, fontSize: 13, lineHeight: 18 },

  tabs: { flexDirection: "row", marginTop: 24 },
  tabButton: { flex: 1, alignItems: "center", gap: 8, paddingTop: 8 },
  tabText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  tabTextActive: { color: colors.tabActive, fontWeight: "900" },
  tabIndicator: { width: "100%", height: 2, backgroundColor: "#e1e4ea" },
  tabIndicatorActive: { backgroundColor: colors.tabActive },

  tabContent: { marginTop: 24, gap: 16 },
  metricRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metricCard: {
    flexGrow: 1,
    flexBasis: "44%",
    minHeight: 118,
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 14,
    gap: 2,
  },
  metricIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  metricLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", letterSpacing: 0.4 },
  metricValue: { color: colors.text, fontSize: 22, fontWeight: "900" },
  metricUnit: { color: colors.muted, fontSize: 12 },

  card: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    padding: 16,
    gap: 14,
  },
  cardTitle: { color: colors.text, fontSize: 17, fontWeight: "900" },

  chipList: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  subjectChip: { borderRadius: 6, backgroundColor: "#f1f3f7", paddingHorizontal: 10, paddingVertical: 6 },
  subjectChipProfile: { backgroundColor: "#dfe8ff" },
  subjectChipText: { color: colors.muted, fontSize: 13, fontWeight: "700" },
  subjectChipTextProfile: { color: "#163462", fontWeight: "800" },

  progressList: { gap: 16 },
  progressRowHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressLabel: { flex: 1, color: colors.text, fontSize: 14, fontWeight: "700" },
  progressValue: { color: colors.text, fontSize: 14, fontWeight: "900" },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: "#eceff5", marginTop: 8, overflow: "hidden" },
  progressFill: { height: 8, borderRadius: 4 },
  progressMeta: { marginTop: 6, color: colors.muted, fontSize: 12 },
  importantBadge: { borderRadius: 4, backgroundColor: "#fde8e8", paddingHorizontal: 6, paddingVertical: 2 },
  importantText: { color: "#c31717", fontSize: 10, fontWeight: "900" },

  scoreBlock: { gap: 6 },
  scoreRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  scoreValue: { color: colors.text, fontSize: 38, fontWeight: "900", lineHeight: 42 },
  scoreMax: { color: colors.muted, fontSize: 18, fontWeight: "700", marginBottom: 5 },
  deltaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginBottom: 7,
  },
  deltaUp: { backgroundColor: "#e4f3ec" },
  deltaDown: { backgroundColor: "#fde8e8" },
  deltaText: { fontSize: 12, fontWeight: "800" },
  deltaTextUp: { color: "#1c7a45" },
  deltaTextDown: { color: "#c31717" },
  scoreHint: { color: colors.text, fontSize: 14 },
  scoreSource: { color: colors.muted, fontSize: 12 },

  chartBox: {
    alignItems: "center",
    borderRadius: 8,
    backgroundColor: "#f7f7f9",
    paddingVertical: 12,
    overflow: "hidden",
  },
  axisText: { color: colors.muted, fontSize: 10 },

  summaryList: { gap: 10 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  summaryLabel: { color: colors.muted, fontSize: 14 },
  summaryValue: { color: colors.text, fontSize: 15, fontWeight: "800" },

  stateSpacing: { marginVertical: 4, gap: 10 },
  errorText: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  emptyText: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  retryButton: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  retryText: { color: colors.blue, fontSize: 14, fontWeight: "800" },

  logoutButton: {
    marginTop: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 10,
    borderColor: "#f0c9c9",
    borderWidth: 1,
    backgroundColor: "#fff6f6",
  },
  logoutText: { color: colors.danger, fontSize: 15, fontWeight: "800" },

  pressed: { opacity: 0.75 },
});
