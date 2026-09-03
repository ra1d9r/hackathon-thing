import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiPost } from "@/services/api";
import { errorText } from "@/services/errors";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";

const audienceCards = [
  {
    icon: "ribbon-outline" as const,
    title: "Сдающие ЕНТ",
    body: "Всестороннее покрытие всех предметов единого национального тестирования с целенаправленной практикой",
  },
  {
    icon: "business-outline" as const,
    title: "Поступающие в НИШ",
    body: "Тщательная логика и специализированная подготовка по предметам для поступления в элитные школы",
  },
  {
    icon: "book-outline" as const,
    title: "Школьники",
    body: "Поддержка, соответствующая учебной программе, чтобы улучшить общую успеваемость и понимание",
  },
];

const featureBlocks = [
  {
    type: "roadmap" as const,
    title: "Адаптивный RoadMaps",
    body: "Учебная программа автоматически подстраивается под твои успехи, концентрируясь на слабых местах, чтобы повысить эффективность",
  },
  {
    type: "tutor" as const,
    title: "AI-репетитор",
    body: "Выбирайся из тупика с репетитором 24/7, который помогает дойти до ответа через вопросы, а не просто даёт готовый ответ",
  },
  {
    type: "analytics" as const,
    title: "Предсказание балла в реальном времени",
    body: "Отслеживайте ваш предполагаемый балл на экзамене постоянно по мере прохождения модулей и практических тестов",
  },
];

const heatmapCells = [
  "#4f80ee",
  "#89d37d",
  "#f4d66f",
  "#f7a56f",
  "#ee6f6b",
  "#dfe6ff",
  "#5d8af0",
  "#a8dd91",
  "#f6e08b",
  "#f7b083",
  "#f07b78",
  "#cfd9ff",
  "#3568df",
  "#8fd48a",
  "#f2cf5f",
  "#e96561",
];

export function MainScreen() {
  const { width } = useWindowDimensions();
  const isNarrow = width < 360;
  const status = useAuthStore((state) => state.status);
  const me = useAuthStore((state) => state.me);
  const [teacherLeadOpen, setTeacherLeadOpen] = useState(false);

  const startLearning = () => {
    if (status !== "signed_in") {
      router.push(routes.register);
      return;
    }
    router.push(me?.requires_onboarding === false ? routes.tabsRoot : routes.usersTargetChoose);
  };
  const enterAsTeacher = () => setTeacherLeadOpen(true);

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.page}
        showsVerticalScrollIndicator={false}
      >
        <Header
          onStart={startLearning}
          onTeacherPress={enterAsTeacher}
          isNarrow={isNarrow}
        />

        <View style={styles.heroSection}>
          <Text style={[styles.heroTitle, isNarrow && styles.heroTitleNarrow]}>
            Подготовка к экзаменам с персональной ИИ-поддержкой
          </Text>
          <Text style={styles.heroText}>
            Набирайте максимальные баллы на ЕНТ, поступайте в НИШ или улучшайте
            школьные результаты с динамически подстраивающимися планами обучения,
            разработанными для вашего успеха.
          </Text>
          <View style={styles.heroActions}>
            <ActionButton
              label="Начать обучение"
              onPress={startLearning}
              size="large"
            />
            <ActionButton
              label="Я учитель"
              onPress={enterAsTeacher}
              variant="outline"
            />
          </View>
          <ProgressMockup />
        </View>

        <Section tone="warm">
          <Text style={styles.centerTitle}>
            Создано для любой цели обучения
          </Text>
          <Text style={styles.centerSubtitle}>
            Специализированные направления, созданные для достижения конкретных
            академических целей
          </Text>
          <View style={styles.audienceList}>
            {audienceCards.map((card) => (
              <AudienceCard key={card.title} {...card} />
            ))}
          </View>
        </Section>

        <Section>
          <Text style={styles.centerTitle}>Как ИИ помогает тебе учиться</Text>
          <View style={styles.featureList}>
            {featureBlocks.map((feature) => (
              <FeatureBlock key={feature.title} {...feature} />
            ))}
          </View>
          <TeacherPortalCard onTeacherPress={enterAsTeacher} />
        </Section>

        <Footer onTeacherPress={enterAsTeacher} />
      </ScrollView>
      <TeacherLeadModal visible={teacherLeadOpen} onClose={() => setTeacherLeadOpen(false)} />
    </SafeAreaView>
  );
}

interface HeaderProps {
  onStart: () => void;
  onTeacherPress: () => void;
  isNarrow: boolean;
}

function Header({ onStart, onTeacherPress, isNarrow }: HeaderProps) {
  return (
    <View style={styles.header}>
      <Text style={styles.logo}>Tlek</Text>
      <View style={styles.headerActions}>
        <ActionButton
          label="Войти как учитель"
          onPress={onTeacherPress}
          compact
          variant="outline"
        />
        <ActionButton
          label="Начать обучение"
          onPress={onStart}
          compact
        />
      </View>
    </View>
  );
}

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  variant?: "solid" | "outline";
  size?: "regular" | "large";
  compact?: boolean;
}

function ActionButton({
  label,
  onPress,
  variant = "solid",
  size = "regular",
  compact = false,
}: ActionButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        variant === "outline" ? styles.outlineButton : styles.solidButton,
        size === "large" && styles.largeButton,
        compact && styles.compactButton,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.actionLabel,
          variant === "outline" ? styles.outlineLabel : styles.solidLabel,
          size === "large" && styles.largeLabel,
          compact && styles.compactLabel,
        ]}
      >
        {label}
        {size === "large" ? " \u2192" : null}
      </Text>
    </Pressable>
  );
}

function Section({
  children,
  tone = "default",
}: React.PropsWithChildren<{ tone?: "default" | "warm" }>) {
  return (
    <View style={[styles.section, tone === "warm" && styles.warmSection]}>
      {children}
    </View>
  );
}

function ProgressMockup() {
  return (
    <View style={styles.browserFrame}>
      <View style={styles.browserTop}>
        <View style={[styles.dot, styles.dotRose]} />
        <View style={[styles.dot, styles.dotOrange]} />
        <View style={[styles.dot, styles.dotBlue]} />
      </View>
      <View style={styles.mockupBody}>
        <View style={styles.progressPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.mockupTitle}>Прогресс</Text>
            <View style={styles.smallBadge}>
              <Text style={styles.smallBadgeText}>Фокус на ЕНТ</Text>
            </View>
          </View>
          <View style={styles.chart}>
            <View style={styles.chartLine} />
          </View>
        </View>
        <View style={styles.subjectRow}>
          <MiniSubject
            icon="calculator-outline"
            title="Логарифмы"
            subtitle="Овладел"
            tint="#d7ebff"
            iconColor="#46a7b0"
          />
          <MiniSubject
            icon="stats-chart-outline"
            title="Геометрия"
            subtitle="Следующая тема"
            tint="#ffd9c7"
            iconColor="#f97316"
            active
          />
        </View>
      </View>
    </View>
  );
}

interface MiniSubjectProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  tint: string;
  iconColor: string;
  active?: boolean;
}

function MiniSubject({
  icon,
  title,
  subtitle,
  tint,
  iconColor,
  active = false,
}: MiniSubjectProps) {
  return (
    <View style={[styles.miniSubject, active && styles.miniSubjectActive]}>
      <View style={[styles.miniIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={16} color={iconColor} />
      </View>
      <Text style={styles.miniTitle}>{title}</Text>
      <Text style={[styles.miniSubtitle, active && styles.activeMiniSubtitle]}>
        {subtitle}
      </Text>
    </View>
  );
}

interface AudienceCardProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

function AudienceCard({ icon, title, body }: AudienceCardProps) {
  return (
    <View style={styles.audienceCard}>
      <View style={styles.iconTile}>
        <Ionicons name={icon} size={24} color="#454b5c" />
      </View>
      <Text style={styles.audienceTitle}>{title}</Text>
      <Text style={styles.audienceBody}>{body}</Text>
    </View>
  );
}

interface FeatureBlockProps {
  type: "roadmap" | "tutor" | "analytics";
  title: string;
  body: string;
}

function FeatureBlock({ type, title, body }: FeatureBlockProps) {
  return (
    <View style={styles.featureBlock}>
      <FeatureVisual type={type} />
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureBody}>{body}</Text>
    </View>
  );
}

function FeatureVisual({ type }: Pick<FeatureBlockProps, "type">) {
  return (
    <View
      style={[
        styles.featureVisual,
        type === "analytics" && styles.analyticsVisual,
      ]}
    >
      {type === "roadmap" ? <RoadmapGraphic /> : null}
      {type === "tutor" ? <TutorGraphic /> : null}
      {type === "analytics" ? <AnalyticsGraphic /> : null}
    </View>
  );
}

function RoadmapGraphic() {
  return (
    <View style={styles.roadmapCanvas}>
      <View style={styles.roadmapSurface}>
        <View style={[styles.roadmapLabel, styles.roadmapLabelTop]}>
          <Text style={styles.roadmapLabelText}>ХИМИЯ</Text>
        </View>
        <View style={[styles.roadmapLabel, styles.roadmapLabelLeft]}>
          <Text style={styles.roadmapLabelText}>МАТЕМАТИКА</Text>
        </View>
        <View style={[styles.roadmapLabel, styles.roadmapLabelRight]}>
          <Text style={styles.roadmapLabelText}>ФИЗИКА</Text>
        </View>
        <View style={[styles.roadmapLine, styles.roadmapLineA]} />
        <View style={[styles.roadmapLine, styles.roadmapLineB]} />
        <View style={[styles.roadmapLine, styles.roadmapLineC]} />
        <View style={[styles.roadmapLine, styles.roadmapLineD]} />
        <View style={[styles.roadmapLine, styles.roadmapLineE]} />
        <View style={[styles.roadmapNode, styles.roadmapNodeRoot]} />
        <View style={[styles.roadmapNode, styles.roadmapNodeMid]} />
        <View style={[styles.roadmapNode, styles.roadmapNodeUpper]} />
        <View style={[styles.roadmapNode, styles.roadmapNodeLower]} />
        <View style={[styles.roadmapNode, styles.roadmapNodeRight]} />
        <View style={[styles.roadmapNode, styles.roadmapNodeFar]} />
      </View>
    </View>
  );
}

function TutorGraphic() {
  return (
    <View style={styles.tutorCanvas}>
      <View style={styles.chatBubbleWide} />
      <View style={styles.chatBubble} />
      <View style={styles.robot}>
        <Ionicons name="hardware-chip-outline" size={42} color="#47a9b0" />
      </View>
      <View style={[styles.chatBubble, styles.chatBubbleBottom]} />
    </View>
  );
}

function AnalyticsGraphic() {
  return (
    <View style={styles.analyticsCanvas}>
      <View style={styles.analyticsCard}>
        <View style={styles.scoreCircle}>
          <Text style={styles.scoreText}>78%</Text>
        </View>
        <View style={styles.metricBars}>
          <View style={[styles.metricBar, { height: 28 }]} />
          <View style={[styles.metricBar, { height: 45 }]} />
          <View style={[styles.metricBar, { height: 34 }]} />
        </View>
      </View>
      <View style={styles.analyticsTrend}>
        <View style={styles.trendLineA} />
        <View style={styles.trendLineB} />
      </View>
    </View>
  );
}

function TeacherPortalCard({ onTeacherPress }: { onTeacherPress: () => void }) {
  return (
    <View style={styles.teacherPortal}>
      <Text style={styles.teacherTitle}>Специальный портал для учителей</Text>
      <Text style={styles.teacherBody}>
        Укрепите своё преподавание с помощью комплексного мониторинга класса.
        Раннее выявляйте учеников, которым трудно даётся материал,
        просматривайте подробные тепловые карты успеваемости и легко назначайте
        целевые задания для дополнительной помощи.
      </Text>
      <ActionButton
        label="Войти как учитель"
        onPress={onTeacherPress}
        variant="outline"
      />
      <View style={styles.classResults}>
        <View style={styles.classHeader}>
          <Ionicons name="grid-outline" size={22} color="#454b5c" />
          <Text style={styles.classTitle}>Результаты класса</Text>
        </View>
        <View style={styles.separator} />
        <View style={styles.heatmap}>
          {heatmapCells.map((color, index) => (
            <View
              key={`${color}-${index}`}
              style={[styles.heatmapCell, { backgroundColor: color }]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function Footer({ onTeacherPress }: { onTeacherPress: () => void }) {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerLogo}>Tlek</Text>
      <View style={styles.footerLinks}>
        <Text style={styles.footerLink}>Политика конфиденциальности</Text>
        <Text style={styles.footerLink}>Условия использования</Text>
      </View>
      <View style={styles.footerLinks}>
        <Text style={styles.footerLink}>Поддержка</Text>
        <Pressable onPress={onTeacherPress}>
          <Text style={styles.footerLink}>Вход для учителей</Text>
        </Pressable>
      </View>
      <Text style={styles.copyright}>
        © 2026 Tlek. Все права защищены.
      </Text>
    </View>
  );
}

interface TeacherRequestResult {
  request_id: string;
  status: "pending" | "approved";

  can_register_now: boolean;
}

function TeacherLeadModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationEmail, setOrganizationEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<TeacherRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  const canSubmit =
    email.trim().length > 3 &&
    displayName.trim().length > 1 &&
    organizationEmail.trim().length > 3 &&
    !isSending;

  useEffect(() => {
    if (visible) return;
    setResult(null);
    setError(null);
  }, [visible]);

  const submit = () => {
    if (!canSubmit) return;
    setIsSending(true);
    setError(null);
    apiPost<TeacherRequestResult>(
      "/v1/auth/teacher-requests",
      {
        email: email.trim().toLowerCase(),
        display_name: displayName.trim(),
        organization_email: organizationEmail.trim().toLowerCase(),
        ...(organizationName.trim() === "" ? {} : { organization_name: organizationName.trim() }),
        ...(message.trim() === "" ? {} : { message: message.trim() }),
      },
      { skipAuth: true },
    )
      .then(setResult)
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось отправить заявку")),
      )
      .finally(() => setIsSending(false));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.teacherModalLayer}>
        <Pressable style={styles.teacherModalBackdrop} onPress={onClose} />
        <View style={styles.teacherModal}>
          <View style={styles.teacherModalHandle} />
          <View style={styles.teacherModalHeader}>
            <View>
              <Text style={styles.teacherModalKicker}>Портал для учителей</Text>
              <Text style={styles.teacherModalTitle}>Заявка на доступ</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={styles.teacherModalClose}>
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>

          {result !== null ? (
            <View style={styles.teacherSuccess}>
              <Ionicons
                name={result.can_register_now ? "checkmark-circle" : "time-outline"}
                size={36}
                color={result.can_register_now ? "#11a857" : "#c84b16"}
              />
              <Text style={styles.teacherSuccessTitle}>
                {result.can_register_now ? "Доступ открыт" : "Заявка принята"}
              </Text>
              <Text style={styles.teacherSuccessText}>
                {result.can_register_now
                  ? "Организация опознана. Можно создавать учительский аккаунт."
                  : "Заявка на рассмотрении. Мы ответим на указанную почту после проверки организации."}
              </Text>
              {result.can_register_now ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onClose();
                    router.push({
                      pathname: "/register",
                      params: { role: "teacher", email: email.trim().toLowerCase() },
                    });
                  }}
                  style={({ pressed }) => [styles.teacherSubmit, pressed && styles.teacherSubmitDisabled]}
                >
                  <Text style={styles.teacherSubmitText}>Создать аккаунт</Text>
                  <Ionicons name="arrow-forward" size={18} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.teacherLeadForm}>
              <TeacherField label="Ваше имя">
                <TextInput
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Айгуль Сериковна"
                  style={styles.teacherInput}
                />
              </TeacherField>
              <TeacherField label="Ваша почта">
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="teacher@example.com"
                  style={styles.teacherInput}
                />
              </TeacherField>
              <TeacherField label="Email организации">
                <TextInput
                  value={organizationEmail}
                  onChangeText={setOrganizationEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="info@school.kz"
                  style={styles.teacherInput}
                />
              </TeacherField>
              <TeacherField label="Организация">
                <TextInput
                  value={organizationName}
                  onChangeText={setOrganizationName}
                  placeholder="Например, Школа-лицей №5"
                  style={styles.teacherInput}
                />
              </TeacherField>
              <TeacherField label="Комментарий">
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Класс, предмет или цель пилота"
                  multiline
                  style={[styles.teacherInput, styles.teacherTextArea]}
                />
              </TeacherField>

              {error ? <Text style={styles.teacherError}>{error}</Text> : null}

              <Pressable
                accessibilityRole="button"
                disabled={!canSubmit}
                onPress={submit}
                style={({ pressed }) => [styles.teacherSubmit, (!canSubmit || pressed) && styles.teacherSubmitDisabled]}
              >
                <Text style={styles.teacherSubmitText}>Отправить заявку</Text>
                <Ionicons name="arrow-forward" size={18} color="#ffffff" />
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

function TeacherField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.teacherField}>
      <Text style={styles.teacherFieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const colors = {
  ink: "#222326",
  muted: "#536382",
  blue: "#274779",
  border: "#c7d0e0",
  page: "#fbfaf9",
  warm: "#f5f3f1",
};

const styles = StyleSheet.create({
  teacherNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    borderColor: "#f0d4b8",
    borderWidth: 1,
    backgroundColor: "#fff7ed",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  teacherNoticeCopy: { flex: 1 },
  teacherNoticeTitle: { color: "#222326", fontSize: 15, fontWeight: "900" },
  teacherNoticeText: { marginTop: 2, color: "#536382", fontSize: 13, lineHeight: 18 },
  teacherNoticeAction: { color: "#274779", fontSize: 13, fontWeight: "900" },
  teacherError: { color: "#c31717", fontSize: 14, lineHeight: 20 },
  safeArea: {
    flex: 1,
    backgroundColor: colors.page,
  },
  scroll: {
    flex: 1,
    backgroundColor: colors.page,
  },
  page: {
    alignItems: "center",
    backgroundColor: colors.page,
  },
  header: {
    width: "100%",
    minHeight: 58,
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    backgroundColor: colors.page,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  logo: {
    color: colors.muted,
    flexShrink: 0,
    fontSize: 22,
    fontWeight: "800",
  },
  headerActions: {
    flexShrink: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  actionButton: {
    minHeight: 48,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    paddingHorizontal: 19,
    paddingVertical: 10,
  },
  solidButton: {
    backgroundColor: colors.blue,
    borderColor: colors.blue,
  },
  outlineButton: {
    backgroundColor: "#ffffff",
    borderColor: colors.border,
  },
  largeButton: {
    minHeight: 76,
    borderRadius: 13,
    paddingHorizontal: 24,
  },
  compactButton: {
    minHeight: 38,
    borderRadius: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  pressed: {
    opacity: 0.78,
  },
  actionLabel: {
    maxWidth: 116,
    textAlign: "center",
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 17,
  },
  solidLabel: {
    color: "#ffffff",
  },
  outlineLabel: {
    color: "#3c4354",
  },
  largeLabel: {
    maxWidth: 230,
    fontSize: 24,
    lineHeight: 30,
  },
  compactLabel: {
    maxWidth: 82,
    fontSize: 11,
    lineHeight: 13,
  },
  heroSection: {
    width: "100%",
    maxWidth: 390,
    paddingHorizontal: 48,
    paddingTop: 80,
    paddingBottom: 64,
  },
  heroTitle: {
    color: colors.ink,
    fontSize: 31,
    fontWeight: "900",
    lineHeight: 33,
  },
  heroTitleNarrow: {
    fontSize: 28,
    lineHeight: 31,
  },
  heroText: {
    marginTop: 40,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 24,
  },
  heroActions: {
    marginTop: 56,
    alignItems: "flex-start",
    gap: 16,
  },
  browserFrame: {
    marginTop: 48,
    overflow: "hidden",
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#fbfbfb",
  },
  browserTop: {
    height: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: 16,
  },
  dot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 1,
  },
  dotRose: {
    backgroundColor: "#ffdedd",
    borderColor: "#f5aaa7",
  },
  dotOrange: {
    backgroundColor: "#e0642c",
    borderColor: "#d75518",
  },
  dotBlue: {
    backgroundColor: "#2464ea",
    borderColor: "#1c55d2",
  },
  mockupBody: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24,
  },
  progressPanel: {
    borderRadius: 4,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    padding: 16,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  mockupTitle: {
    color: colors.muted,
    fontSize: 20,
    fontWeight: "800",
  },
  smallBadge: {
    borderRadius: 3,
    backgroundColor: "#dfe8ff",
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  smallBadgeText: {
    color: "#163462",
    fontSize: 11,
    fontWeight: "800",
  },
  chart: {
    height: 95,
    marginTop: 16,
    overflow: "hidden",
    backgroundColor: "#f2f0f0",
  },
  chartLine: {
    position: "absolute",
    left: 2,
    right: -6,
    bottom: 27,
    height: 3,
    backgroundColor: "#46a7b0",
    transform: [{ rotate: "-19deg" }],
  },
  subjectRow: {
    marginTop: 56,
    flexDirection: "row",
    gap: 8,
  },
  miniSubject: {
    flex: 1,
    minHeight: 80,
    borderRadius: 3,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    padding: 12,
  },
  miniSubjectActive: {
    borderColor: "#4f86ff",
  },
  miniIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  miniTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
  },
  miniSubtitle: {
    color: colors.ink,
    fontSize: 11,
  },
  activeMiniSubtitle: {
    color: "#1266ff",
    fontWeight: "700",
  },
  section: {
    width: "100%",
    alignItems: "center",
    paddingHorizontal: 48,
    paddingVertical: 68,
  },
  warmSection: {
    backgroundColor: colors.warm,
  },
  centerTitle: {
    width: "100%",
    maxWidth: 330,
    color: colors.muted,
    fontSize: 31,
    fontWeight: "900",
    lineHeight: 39,
    textAlign: "center",
  },
  centerSubtitle: {
    width: "100%",
    maxWidth: 310,
    marginTop: 10,
    color: colors.muted,
    fontSize: 16,
    lineHeight: 23,
    textAlign: "center",
  },
  audienceList: {
    width: "100%",
    maxWidth: 294,
    marginTop: 50,
    gap: 24,
  },
  audienceCard: {
    minHeight: 224,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#f4f2ec",
    padding: 24,
  },
  iconTile: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 3,
    backgroundColor: "#ffffff",
    marginBottom: 22,
  },
  audienceTitle: {
    color: colors.muted,
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 25,
  },
  audienceBody: {
    marginTop: 12,
    color: "#4b5060",
    fontSize: 15,
    lineHeight: 22,
  },
  featureList: {
    width: "100%",
    maxWidth: 294,
    marginTop: 58,
    gap: 34,
  },
  featureBlock: {
    width: "100%",
  },
  featureVisual: {
    height: 160,
    overflow: "hidden",
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#eff7fb",
  },
  analyticsVisual: {
    height: 200,
    borderTopLeftRadius: 7,
    borderTopRightRadius: 42,
  },
  featureTitle: {
    marginTop: 20,
    color: colors.muted,
    fontSize: 21,
    fontWeight: "800",
    lineHeight: 27,
  },
  featureBody: {
    marginTop: 12,
    color: "#464c5c",
    fontSize: 15,
    lineHeight: 22,
  },
  roadmapCanvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#edf6f7",
  },
  roadmapSurface: {
    width: "86%",
    maxWidth: 250,
    height: 116,
    position: "relative",
  },
  roadmapLabel: {
    position: "absolute",
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.82)",
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  roadmapLabelTop: {
    left: "35%",
    top: 2,
  },
  roadmapLabelLeft: {
    left: 0,
    top: 68,
  },
  roadmapLabelRight: {
    right: 0,
    top: 66,
  },
  roadmapLabelText: {
    color: "rgba(83,99,130,0.58)",
    fontSize: 9,
    fontWeight: "800",
  },
  roadmapLine: {
    position: "absolute",
    height: 5,
    borderRadius: 5,
    backgroundColor: "#47a9b0",
  },
  roadmapLineA: {
    left: "19%",
    top: 62,
    width: "25%",
    transform: [{ rotate: "-24deg" }],
  },
  roadmapLineB: {
    left: "38%",
    top: 54,
    width: "20%",
    transform: [{ rotate: "18deg" }],
  },
  roadmapLineC: {
    left: "52%",
    top: 63,
    width: "22%",
    transform: [{ rotate: "-16deg" }],
  },
  roadmapLineD: {
    left: "38%",
    top: 81,
    width: "20%",
    transform: [{ rotate: "-20deg" }],
  },
  roadmapLineE: {
    left: "56%",
    top: 82,
    width: "20%",
    transform: [{ rotate: "21deg" }],
  },
  roadmapNode: {
    position: "absolute",
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    borderRadius: 9,
    borderWidth: 4,
    borderColor: "#47a9b0",
    backgroundColor: "#edf6f7",
  },
  roadmapNodeRoot: {
    left: "20%",
    top: 70,
  },
  roadmapNodeMid: {
    left: "43%",
    top: 56,
  },
  roadmapNodeUpper: {
    left: "60%",
    top: 68,
  },
  roadmapNodeLower: {
    left: "52%",
    top: 88,
  },
  roadmapNodeRight: {
    left: "76%",
    top: 56,
  },
  roadmapNodeFar: {
    left: "78%",
    top: 96,
  },
  faintPill: {
    position: "absolute",
    height: 14,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  pillOne: {
    width: 170,
    left: 54,
    top: 52,
  },
  pillTwo: {
    width: 118,
    left: 96,
    top: 86,
  },
  pathDot: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#47a9b0",
  },
  pathDotStart: {
    left: 126,
    top: 72,
  },
  pathDotEnd: {
    left: 176,
    top: 104,
  },
  pathLineOne: {
    position: "absolute",
    left: 135,
    top: 78,
    width: 42,
    height: 6,
    borderRadius: 4,
    backgroundColor: "#47a9b0",
  },
  pathLineTwo: {
    position: "absolute",
    left: 154,
    top: 92,
    width: 34,
    height: 6,
    borderRadius: 4,
    backgroundColor: "#47a9b0",
    transform: [{ rotate: "40deg" }],
  },
  tutorCanvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f6fbff",
  },
  chatBubbleWide: {
    width: 150,
    height: 26,
    borderRadius: 6,
    backgroundColor: "#d7e7ff",
    marginBottom: 8,
  },
  chatBubble: {
    width: 110,
    height: 20,
    borderRadius: 5,
    backgroundColor: "#b9d5ff",
  },
  chatBubbleBottom: {
    marginTop: 8,
    width: 130,
  },
  robot: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  analyticsCanvas: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef6f4",
  },
  analyticsCard: {
    width: 206,
    height: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.84)",
  },
  scoreCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    borderColor: "#a4d9d6",
    borderWidth: 6,
  },
  scoreText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  metricBars: {
    height: 60,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  metricBar: {
    width: 13,
    borderRadius: 3,
    backgroundColor: "#8dc8d0",
  },
  analyticsTrend: {
    position: "absolute",
    width: 80,
    height: 40,
    left: 124,
    top: 90,
  },
  trendLineA: {
    position: "absolute",
    left: 0,
    top: 22,
    width: 42,
    height: 5,
    borderRadius: 4,
    backgroundColor: "#47a9b0",
    transform: [{ rotate: "-34deg" }],
  },
  trendLineB: {
    position: "absolute",
    left: 34,
    top: 12,
    width: 42,
    height: 5,
    borderRadius: 4,
    backgroundColor: "#47a9b0",
    transform: [{ rotate: "28deg" }],
  },
  teacherPortal: {
    width: "100%",
    maxWidth: 294,
    marginTop: 72,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#edf4ff",
    padding: 16,
    gap: 22,
  },
  teacherTitle: {
    color: colors.muted,
    fontSize: 34,
    fontWeight: "900",
    lineHeight: 41,
  },
  teacherBody: {
    color: "#464c5c",
    fontSize: 16,
    lineHeight: 25,
  },
  classResults: {
    borderRadius: 7,
    backgroundColor: "#fffefa",
    padding: 16,
    shadowColor: "#40506d",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  classHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  classTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  separator: {
    height: 1,
    marginTop: 12,
    backgroundColor: colors.border,
  },
  heatmap: {
    marginTop: 16,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  heatmapCell: {
    width: "22%",
    aspectRatio: 1,
    borderRadius: 4,
  },
  footer: {
    width: "100%",
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingHorizontal: 48,
    paddingTop: 34,
    paddingBottom: 24,
    backgroundColor: colors.page,
  },
  footerLogo: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "900",
  },
  footerLinks: {
    marginTop: 24,
    flexDirection: "row",
    justifyContent: "center",
    gap: 24,
    flexWrap: "wrap",
  },
  footerLink: {
    color: "#3f4352",
    fontSize: 14,
  },
  copyright: {
    width: "100%",
    maxWidth: 294,
    marginTop: 22,
    color: "#005fd4",
    fontSize: 15,
    lineHeight: 21,
  },
  teacherModalLayer: {
    flex: 1,
    justifyContent: "flex-end",
  },
  teacherModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  teacherModal: {
    width: "100%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: colors.page,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  teacherModalHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    backgroundColor: colors.border,
    marginBottom: 18,
  },
  teacherModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  teacherModalKicker: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  teacherModalTitle: {
    marginTop: 4,
    color: colors.ink,
    fontSize: 26,
    fontWeight: "900",
    lineHeight: 32,
  },
  teacherModalClose: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: "#ffffff",
  },
  teacherLeadForm: {
    marginTop: 22,
    gap: 14,
  },
  teacherField: {
    gap: 7,
  },
  teacherFieldLabel: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "800",
  },
  teacherInput: {
    minHeight: 48,
    borderRadius: 9,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    color: colors.ink,
    fontSize: 15,
  },
  teacherTextArea: {
    minHeight: 86,
    paddingTop: 12,
    textAlignVertical: "top",
  },
  teacherSubmit: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: colors.blue,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 6,
  },
  teacherSubmitDisabled: {
    opacity: 0.52,
  },
  teacherSubmitText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "900",
  },
  teacherSuccess: {
    marginTop: 26,
    borderRadius: 12,
    borderColor: "#bee6cf",
    borderWidth: 1,
    backgroundColor: "#f0fbf5",
    alignItems: "center",
    padding: 22,
  },
  teacherSuccessTitle: {
    marginTop: 10,
    color: colors.ink,
    fontSize: 20,
    fontWeight: "900",
  },
  teacherSuccessText: {
    marginTop: 6,
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
