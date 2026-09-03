import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { apiGet, apiPost } from "@/services/api";
import { errorText } from "@/services/errors";
import { SELECTABLE_GRADES } from "@/constants/grades";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";
import { teacherStyles as shared, teacherColors as colors } from "@/screens/teacher/styles";

export interface TeacherClass {
  id: string;
  name: string;
  grade: number | null;
  subject: { id: string; code: string; name: string } | null;
  is_archived: boolean;
  member_count: number;
  chat_channel_id: string | null;
  created_at: string;
}

interface ClassListResponse {
  classes: TeacherClass[];
  empty_reason: "no_classes" | null;
}

export function TeacherClassesScreen() {
  const me = useAuthStore((state) => state.me);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState("");
  const [grade, setGrade] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    apiGet<ClassListResponse>("/v1/classes")
      .then((response) => setClasses(response.classes))
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось загрузить классы")),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  const createClass = () => {
    const title = name.trim();
    if (title === "" || isSaving) return;

    setIsSaving(true);
    apiPost("/v1/classes", { name: title, ...(grade === null ? {} : { grade }) })
      .then(() => {
        setName("");
        setGrade(null);
        setIsCreating(false);
        load();
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось создать класс")),
      )
      .finally(() => setIsSaving(false));
  };

  return (
    <SafeAreaView style={shared.safeArea} edges={["top"]}>
      <View style={shared.root}>
        <View style={shared.header}>
          <View>
            <Text style={shared.logo}>Tlek</Text>
            <Text style={shared.headerSubtitle}>{me?.display_name ?? "Учитель"}</Text>
          </View>
          <Pressable
            accessibilityLabel="Личный кабинет"
            accessibilityRole="button"
            onPress={() => router.push(routes.personalAccount)}
            style={({ pressed }) => [shared.avatarButton, pressed && shared.pressed]}
          >
            <Avatar uri={me?.avatar_url} name={me?.display_name} size={34} />
          </Pressable>
        </View>

        <ScrollView
          style={shared.scroll}
          contentContainerStyle={shared.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={shared.titleBlock}>
            <Text style={shared.title}>Классы</Text>
            <Text style={shared.subtitle}>
              Добавляйте учеников по коду из их профиля, отправляйте материалы и переписывайтесь
              с классом.
            </Text>
          </View>

          {error ? <Text style={shared.errorText}>{error}</Text> : null}
          {isLoading ? <ActivityIndicator color={colors.blue} style={{ marginTop: 12 }} /> : null}

          {isCreating ? (
            <View style={shared.card}>
              <Text style={shared.cardTitle}>Новый класс</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Например, 9 «А» — алгебра"
                style={shared.input}
              />
              <Text style={shared.fieldLabel}>Класс обучения (необязательно)</Text>
              <View style={styles.gradeRow}>
                {SELECTABLE_GRADES.map((value) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    onPress={() => setGrade(grade === value ? null : value)}
                    style={[styles.gradeChip, grade === value && styles.gradeChipActive]}
                  >
                    <Text
                      style={[styles.gradeChipText, grade === value && styles.gradeChipTextActive]}
                    >
                      {value}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.formActions}>
                <Pressable accessibilityRole="button" onPress={() => setIsCreating(false)}>
                  <Text style={shared.ghostAction}>Отмена</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={name.trim() === "" || isSaving}
                  onPress={createClass}
                  style={({ pressed }) => [
                    shared.primaryButton,
                    (name.trim() === "" || isSaving) && shared.disabled,
                    pressed && shared.pressed,
                  ]}
                >
                  <Text style={shared.primaryButtonText}>Создать</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsCreating(true)}
              style={({ pressed }) => [shared.addButton, pressed && shared.pressed]}
            >
              <Ionicons name="add" size={20} color={colors.navy} />
              <Text style={shared.addButtonText}>Создать класс</Text>
            </Pressable>
          )}

          {!isLoading && classes.length === 0 ? (
            <Text style={shared.emptyText}>
              Классов пока нет. Создайте первый — и добавьте в него учеников по их коду.
            </Text>
          ) : null}

          <View style={shared.list}>
            {classes.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() =>
                  router.push({ pathname: "/class-members", params: { classId: item.id } })
                }
                style={({ pressed }) => [shared.card, pressed && shared.pressed]}
              >
                <View style={styles.classHead}>
                  <Text style={shared.cardTitle}>{item.name}</Text>
                  <Ionicons name="chevron-forward" size={20} color={colors.muted} />
                </View>
                <Text style={shared.cardMeta}>
                  {item.member_count} учеников
                  {item.grade === null ? "" : ` · ${item.grade} класс`}
                  {item.subject === null ? "" : ` · ${item.subject.name}`}
                  {item.is_archived ? " · в архиве" : ""}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  gradeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  gradeChip: {
    minWidth: 40,
    alignItems: "center",
    borderRadius: 8,
    borderColor: colors.border,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  gradeChipActive: { borderColor: colors.blue, backgroundColor: "#eef4ff" },
  gradeChipText: { color: colors.text, fontSize: 15, fontWeight: "800" },
  gradeChipTextActive: { color: colors.blue },
  formActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 18,
    marginTop: 18,
  },
  classHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
});
