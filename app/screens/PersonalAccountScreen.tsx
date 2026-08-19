import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { LineChart } from "react-native-gifted-charts";
import { SafeAreaView } from "react-native-safe-area-context";

import { routes } from "@/types/navigation";

type AccountTab = "main" | "stats";

const profileImage = "https://i.pravatar.cc/160?img=12";
const userId = "STU-89241";

const metrics = [
  { label: "СЕРИЯ", value: "X Дней", icon: "flame" as const, color: "#c84b16", background: "#fdeee7" },
  { label: "ОБЩАЯ ПРАКТИКА", value: "X задании", icon: "time-outline" as const, color: "#1f66ff", background: "#edf3ff" },
  { label: "ПОМОЩИ ИИ ИСПОЛЬЗОВАНО", value: "X", icon: "hardware-chip-outline" as const, color: "#666a72", background: "#f0f0f0" }
];

const progressRows = [
  { label: "Математическая грамотность", value: 85, color: "#2b63f1" },
  { label: "История Казахстана", value: 70, color: "#5f84e8" },
  { label: "Физика", value: 42, color: "#c91f1f", important: true },
  { label: "Математика", value: 30, color: "#c91f1f", important: true },
  { label: "Грамотность чтения", value: 16, color: "#c91f1f", important: true }
];

const gradeChartData = [
  { value: 2, label: "Д1" },
  { value: 4, label: "Д2" },
  { value: 5, label: "Д3" },
  { value: 7, label: "Д4" },
  { value: 9, label: "Д5" },
];

export function PersonalAccountScreen() {
  const [activeTab, setActiveTab] = useState<AccountTab>("main");

  const copyUserId = async () => {
    await Clipboard.setStringAsync(userId);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <Header />
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ProfileCard onCopyUserId={copyUserId} />
          <SegmentedTabs activeTab={activeTab} onChange={setActiveTab} />
          {activeTab === "main" ? <MainTab /> : <StatsTab />}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.logo}>EduPrep</Text>
      <Pressable
        accessibilityLabel="Back to dashboard"
        accessibilityRole="button"
        onPress={() => router.back()}
        style={({ pressed }) => [styles.headerAvatarButton, pressed && styles.pressed]}
      >
        <Image source={{ uri: profileImage }} style={styles.headerAvatar} />
      </Pressable>
    </View>
  );
}

function ProfileCard({ onCopyUserId }: { onCopyUserId: () => void }) {
  return (
    <View style={styles.profileCard}>
      <Image source={{ uri: profileImage }} style={styles.profileAvatar} />
      <View style={styles.profileInfo}>
        <Text style={styles.userName}>Aibar Serikov</Text>
        <View style={styles.gradeBadge}>
          <Text style={styles.gradeText}>Класс 11 А</Text>
        </View>
        <Pressable
          accessibilityLabel="Copy user ID"
          accessibilityRole="button"
          onPress={onCopyUserId}
          style={({ pressed }) => [styles.idBadge, pressed && styles.pressed]}
        >
          <View>
            <Text style={styles.idLabel}>User ID</Text>
            <Text style={styles.idValue}>{userId}</Text>
          </View>
          <Ionicons name="copy-outline" size={24} color={colors.muted} />
        </Pressable>
      </View>
    </View>
  );
}

interface SegmentedTabsProps {
  activeTab: AccountTab;
  onChange: (tab: AccountTab) => void;
}

function SegmentedTabs({ activeTab, onChange }: SegmentedTabsProps) {
  return (
    <View style={styles.tabs}>
      <TabButton label="Главное" active={activeTab === "main"} onPress={() => onChange("main")} />
      <TabButton label="Статистика" active={activeTab === "stats"} onPress={() => onChange("stats")} />
    </View>
  );
}

function TabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={styles.tabButton}>
      <Text style={[styles.tabText, active && styles.tabTextActive]}>{label}</Text>
      <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
    </Pressable>
  );
}

function MainTab() {
  return (
    <View style={styles.tabContent}>
      {metrics.map((metric) => (
        <MetricCard key={metric.label} {...metric} />
      ))}
      <ProgressCard />
      <CriticalAlert />
    </View>
  );
}

function MetricCard({ label, value, icon, color, background }: (typeof metrics)[number]) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIconBox, { backgroundColor: background }]}>
        <Ionicons name={icon} size={25} color={color} />
      </View>
      <View style={styles.metricCopy}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>{value}</Text>
      </View>
    </View>
  );
}

function ProgressCard() {
  return (
    <View style={styles.progressCard}>
      <Text style={styles.cardTitle}>Изучено</Text>
      <View style={styles.progressList}>
        {progressRows.map((item) => (
          <ProgressRow key={item.label} {...item} />
        ))}
      </View>
    </View>
  );
}

function ProgressRow({ label, value, color, important = false }: (typeof progressRows)[number]) {
  return (
    <View>
      <View style={styles.progressRowHeader}>
        <Text style={styles.progressLabel}>{label}</Text>
        {important ? (
          <View style={styles.importantBadge}>
            <Text style={styles.importantText}>ВАЖНО</Text>
          </View>
        ) : null}
        <Text style={styles.progressValue}>{value}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${value}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function CriticalAlert() {
  return (
    <View style={styles.alertCard}>
      <View style={styles.alertHeader}>
        <Ionicons name="warning-outline" size={26} color="#dc2020" />
        <Text style={styles.alertTitle}>Критическая тема найдена</Text>
      </View>
      <Text style={styles.alertBody}>
        Результаты по логарифмическим функциям (пересечение физики и математики) сейчас ниже целевого уровня. Появляются
        постоянные ошибки при изоляции переменных.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push(routes.taskExecutionWorkspace)}
        style={({ pressed }) => [styles.alertButton, pressed && styles.pressed]}
      >
        <Text style={styles.alertButtonText}>Пройти задания</Text>
      </Pressable>
    </View>
  );
}

function StatsTab() {
  const { width } = useWindowDimensions();
  const chartWidth = Math.min(width - 92, 280);

  return (
    <View style={styles.tabContent}>
      <View style={styles.statsCard}>
        <Text style={styles.cardTitle}>Статистика оценок</Text>
        <View style={styles.chartBox}>
          <LineChart
            data={gradeChartData}
            color="#3B82F6"
            thickness={3}
            dataPointsColor="#3B82F6"
            dataPointsRadius={6}
            maxValue={10}
            noOfSections={2}
            yAxisOffset={1}
            hideRules
            initialSpacing={20}
            spacing={50}
            curved={false}
            isAnimated
            width={chartWidth}
            height={210}
            backgroundColor="#f5f2f2"
            xAxisColor="transparent"
            yAxisColor="transparent"
            yAxisTextStyle={styles.axisText}
            xAxisLabelTextStyle={styles.axisText}
            adjustToWidth={chartWidth < 270}
          />
        </View>
      </View>
    </View>
  );
}

const colors = {
  background: "#fbfaf9",
  card: "#ffffff",
  profile: "#f4f2f2",
  text: "#202124",
  muted: "#4f5362",
  border: "#c5cede",
  blue: "#0057d9",
  tabActive: "#45a8b0"
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background
  },
  root: {
    flex: 1,
    backgroundColor: colors.background
  },
  scroll: {
    flex: 1
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 64
  },
  header: {
    width: "100%",
    height: 63,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: "#e1e4ea",
    borderBottomWidth: 1,
    paddingHorizontal: 16
  },
  logo: {
    color: colors.blue,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  headerAvatarButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff"
  },
  headerAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderColor: "#ffffff",
    borderWidth: 2
  },
  profileCard: {
    minHeight: 190,
    marginTop: 33,
    borderRadius: 6,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.profile,
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20
  },
  profileAvatar: {
    width: 80,
    height: 80,
    borderRadius: 10,
    borderColor: "#1765ff",
    borderWidth: 2
  },
  profileInfo: {
    flex: 1,
    paddingLeft: 24
  },
  userName: {
    color: colors.text,
    fontSize: 25,
    fontWeight: "900",
    lineHeight: 31
  },
  gradeBadge: {
    width: 84,
    minHeight: 21,
    alignItems: "center",
    justifyContent: "center",
    borderColor: colors.border,
    borderWidth: 1,
    marginTop: 6
  },
  gradeText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 16
  },
  idBadge: {
    width: 170,
    minHeight: 60,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: "#ffffff",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginTop: 20,
    marginLeft: -106
  },
  idLabel: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 15
  },
  idValue: {
    color: colors.text,
    fontSize: 17,
    fontWeight: "900",
    lineHeight: 22
  },
  tabs: {
    height: 84,
    flexDirection: "row",
    alignItems: "flex-end",
    borderBottomColor: colors.border,
    borderBottomWidth: 1
  },
  tabButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    height: 52
  },
  tabText: {
    color: colors.muted,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22
  },
  tabTextActive: {
    color: colors.tabActive
  },
  tabIndicator: {
    width: "58%",
    height: 2,
    marginTop: 15,
    backgroundColor: "transparent"
  },
  tabIndicatorActive: {
    backgroundColor: colors.tabActive
  },
  tabContent: {
    paddingTop: 32,
    gap: 18
  },
  metricCard: {
    minHeight: 82,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16
  },
  metricIconBox: {
    width: 40,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 2
  },
  metricCopy: {
    flex: 1,
    paddingLeft: 16
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.35,
    lineHeight: 16
  },
  metricValue: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
    lineHeight: 29
  },
  progressCard: {
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 20,
    marginTop: 20
  },
  cardTitle: {
    color: colors.text,
    fontSize: 23,
    fontWeight: "900",
    lineHeight: 30
  },
  progressList: {
    marginTop: 20,
    gap: 10
  },
  progressRowHeader: {
    minHeight: 21,
    flexDirection: "row",
    alignItems: "center"
  },
  progressLabel: {
    flexShrink: 1,
    color: colors.text,
    fontSize: 14,
    lineHeight: 19
  },
  importantBadge: {
    borderRadius: 2,
    backgroundColor: "#ffdada",
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginLeft: 8,
    marginRight: 8
  },
  importantText: {
    color: "#cf2222",
    fontSize: 9,
    fontWeight: "900"
  },
  progressValue: {
    marginLeft: "auto",
    color: colors.muted,
    fontSize: 14,
    lineHeight: 19
  },
  progressTrack: {
    height: 7,
    overflow: "hidden",
    borderRadius: 5,
    backgroundColor: "#dfdddb",
    marginTop: 4
  },
  progressFill: {
    height: "100%",
    borderRadius: 5
  },
  alertCard: {
    borderLeftColor: colors.border,
    borderLeftWidth: 4,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 24,
    paddingTop: 30,
    paddingBottom: 26,
    marginTop: 6
  },
  alertHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12
  },
  alertTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 21,
    fontWeight: "900",
    lineHeight: 27
  },
  alertBody: {
    marginTop: 12,
    color: colors.muted,
    fontSize: 17,
    lineHeight: 24
  },
  alertButton: {
    width: 153,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#245cf2",
    marginTop: 18
  },
  alertButtonText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "900"
  },
  statsCard: {
    minHeight: 350,
    borderRadius: 7,
    borderColor: colors.border,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 24
  },
  chartBox: {
    height: 256,
    overflow: "hidden",
    borderRadius: 3,
    borderColor: "#d8d8dc",
    borderWidth: 1,
    backgroundColor: "#f5f2f2",
    marginTop: 18,
    paddingTop: 10,
    paddingRight: 6,
    paddingBottom: 6
  },
  axisText: {
    color: colors.muted,
    fontSize: 12
  },
  pressed: {
    opacity: 0.76
  }
});
