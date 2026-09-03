import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { LessonReader } from "@/components/LessonReader";
import { apiGet, apiPost } from "@/services/api";
import { errorText } from "@/services/errors";
import {
  ACCEPTED_HINT,
  ACCEPTED_MIME_TYPES,
  deleteMaterial,
  fetchFileUrl,
  fetchMaterial,
  uploadMaterialFile,
  type MaterialDetail,
} from "@/services/materials";
import { useAuthStore } from "@/store/useAuthStore";
import { routes } from "@/types/navigation";
import { teacherStyles as shared, teacherColors as colors } from "@/screens/teacher/styles";
import type { TeacherClass } from "@/screens/teacher/TeacherClassesScreen";

interface Material {
  id: string;
  title: string;
  summary: string | null;
  format: string;
  status: "draft" | "published" | "blocked";
  created_at: string;
}

interface MaterialListResponse {
  materials: Material[];
  empty_reason: "no_materials" | null;
}

interface Distribution {
  id: string;
  material: { id: string; title: string; format: string };
  class_id: string | null;
  class_name: string | null;
  message_md: string | null;
  due_at: string | null;
  created_at: string;
  seen_count: number;
  recipient_count: number;
}

interface DistributionListResponse {
  distributions: Distribution[];
  empty_reason: "no_distributions" | null;
}

interface ClassListResponse {
  classes: TeacherClass[];
}

export function TeacherMaterialsScreen() {
  const me = useAuthStore((state) => state.me);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [classes, setClasses] = useState<TeacherClass[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isComposing, setIsComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [sending, setSending] = useState<Material | null>(null);
  const [viewing, setViewing] = useState<Material | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const [progress, setProgress] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([
      apiGet<MaterialListResponse>("/v1/materials"),
      apiGet<DistributionListResponse>("/v1/distributions"),
      apiGet<ClassListResponse>("/v1/classes"),
    ])
      .then(([materialList, distributionList, classList]) => {
        setMaterials(materialList.materials);
        setDistributions(distributionList.distributions);
        setClasses(classList.classes);
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось загрузить материалы")),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useFocusEffect(useCallback(() => load(), [load]));

  const createMaterial = () => {
    const name = title.trim();
    const text = body.trim();
    if (name === "" || text === "" || isSaving) return;

    setIsSaving(true);
    apiPost("/v1/materials", { format: "markdown", title: name, body_md: text })
      .then(() => {
        setTitle("");
        setBody("");
        setIsComposing(false);
        load();
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось сохранить материал")),
      )
      .finally(() => setIsSaving(false));
  };

  const attachFile = () => {
    if (isUploading) return;

    setError(null);
    DocumentPicker.getDocumentAsync({ type: ACCEPTED_MIME_TYPES, copyToCacheDirectory: true })
      .then((picked) => {
        const asset = picked.canceled ? undefined : picked.assets[0];
        if (asset === undefined) return undefined;

        setIsUploading(true);
        setProgress(0);
        const name = title.trim();
        return uploadMaterialFile(
          { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, size: asset.size },
          { title: name === "" ? asset.name : name },
          setProgress,
        ).then(() => {
          setTitle("");
          setBody("");
          setIsComposing(false);
          load();
        });
      })
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось загрузить файл")),
      )
      .finally(() => {
        setIsUploading(false);
        setProgress(null);
      });
  };

  const confirmDelete = (material: Material) => {
    if (deletingId !== null) return;
    if (pendingDeleteId !== material.id) {
      setPendingDeleteId(material.id);
      return;
    }

    setPendingDeleteId(null);
    setDeletingId(material.id);
    setError(null);
    deleteMaterial(material.id)
      .then(() => load())
      .catch((e: unknown) => setError(errorText(e, "Не удалось удалить материал")))
      .finally(() => setDeletingId(null));
  };

  return (
    <SafeAreaView style={shared.safeArea} edges={["top"]}>
      <View style={shared.root}>
        <View style={shared.header}>
          <View>
            <Text style={shared.logo}>Tlek</Text>
            <Text style={shared.headerSubtitle}>Материалы</Text>
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
            <Text style={shared.title}>Уроки для класса</Text>
            <Text style={shared.subtitle}>
              Текст с разметкой: # заголовок, **жирный**, *курсив*, - список, {"> "}цитата.
              Отправка классу отмечается как просмотренная, когда ученик открывает материал.
            </Text>
          </View>

          {error ? <Text style={shared.errorText}>{error}</Text> : null}
          {isLoading ? <ActivityIndicator color={colors.blue} style={{ marginTop: 12 }} /> : null}

          {isComposing ? (
            <View style={shared.card}>
              <Text style={shared.cardTitle}>Новый материал</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Название урока"
                style={shared.input}
              />
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder={"## Тема\n\nОсновная мысль урока.\n\n- первый пункт\n- второй пункт"}
                multiline
                style={[shared.input, shared.textArea]}
              />
              <View style={styles.formActions}>
                <Pressable accessibilityRole="button" onPress={() => setIsComposing(false)}>
                  <Text style={shared.ghostAction}>Отмена</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={title.trim() === "" || body.trim() === "" || isSaving}
                  onPress={createMaterial}
                  style={({ pressed }) => [
                    shared.primaryButton,
                    (title.trim() === "" || body.trim() === "" || isSaving) && shared.disabled,
                    pressed && shared.pressed,
                  ]}
                >
                  <Text style={shared.primaryButtonText}>Сохранить</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setIsComposing(true)}
              style={({ pressed }) => [shared.addButton, pressed && shared.pressed]}
            >
              <Ionicons name="add" size={20} color={colors.navy} />
              <Text style={shared.addButtonText}>Написать материал</Text>
            </Pressable>
          )}

          <Pressable
            accessibilityRole="button"
            disabled={isUploading}
            onPress={attachFile}
            style={({ pressed }) => [
              shared.addButton,
              styles.attachButton,
              isUploading && shared.disabled,
              pressed && shared.pressed,
            ]}
          >
            {isUploading ? (
              <ActivityIndicator color={colors.navy} />
            ) : (
              <Ionicons name="attach" size={20} color={colors.navy} />
            )}
            <Text style={shared.addButtonText}>
              {isUploading
                ? progress === null
                  ? "Загружаю файл…"
                  : `Загружаю файл… ${String(Math.round(progress * 100))}%`
                : "Прикрепить файл"}
            </Text>
          </Pressable>

          {isUploading && progress !== null ? (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
            </View>
          ) : null}
          <Text style={styles.attachHint}>{ACCEPTED_HINT}. Название возьмётся из формы выше.</Text>

          {!isLoading && materials.length === 0 ? (
            <Text style={shared.emptyText}>Материалов пока нет.</Text>
          ) : null}

          <View style={shared.list}>
            {materials.map((material) => (
              <View key={material.id} style={shared.card}>
                <Pressable accessibilityRole="button" onPress={() => setViewing(material)}>
                  <Text style={shared.cardTitle}>{material.title}</Text>
                  <Text style={shared.cardMeta}>
                    {material.summary ?? formatLabel(material.format)} ·{" "}
                    {material.status === "published" ? "опубликован" : material.status}
                  </Text>
                  <Text style={styles.openHint}>Нажмите, чтобы открыть</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={classes.length === 0}
                  onPress={() => setSending(material)}
                  style={({ pressed }) => [
                    shared.primaryButton,
                    styles.sendAction,
                    classes.length === 0 && shared.disabled,
                    pressed && shared.pressed,
                  ]}
                >
                  <Text style={shared.primaryButtonText}>
                    {classes.length === 0 ? "Сначала создайте класс" : "Отправить классу"}
                  </Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Удалить материал «${material.title}»`}
                  disabled={deletingId !== null}
                  onPress={() => confirmDelete(material)}
                  style={({ pressed }) => [styles.deleteAction, pressed && shared.pressed]}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.orange} />
                  <Text style={styles.deleteActionText}>
                    {deletingId === material.id
                      ? "Удаляю…"
                      : pendingDeleteId === material.id
                        ? "Нажмите ещё раз, чтобы удалить"
                        : "Удалить"}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>

          {distributions.length > 0 ? (
            <>
              <Text style={styles.sectionTitle}>Отправленное</Text>
              <View style={shared.list}>
                {distributions.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    onPress={() =>
                      setViewing({
                        id: item.material.id,
                        title: item.material.title,
                        summary: null,
                        format: item.material.format,
                        status: "published",
                        created_at: item.created_at,
                      })
                    }
                    style={({ pressed }) => [shared.card, pressed && shared.pressed]}
                  >
                    <Text style={shared.cardTitle}>{item.material.title}</Text>
                    <Text style={shared.cardMeta}>
                      {item.class_name ?? "Ученику"} · открыли {item.seen_count} из{" "}
                      {item.recipient_count}
                    </Text>
                    {item.message_md === null ? null : (
                      <Text style={styles.distributionNote}>{item.message_md}</Text>
                    )}
                    <Text style={styles.openHint}>Нажмите, чтобы открыть</Text>
                  </Pressable>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>

        <MaterialSheet material={viewing} onClose={() => setViewing(null)} />

        <SendSheet
          material={sending}
          classes={classes}
          onClose={() => setSending(null)}
          onSent={() => {
            setSending(null);
            load();
          }}
          onError={setError}
        />
      </View>
    </SafeAreaView>
  );
}

function formatLabel(format: string): string {
  switch (format) {
    case "markdown":
      return "Текст с разметкой";
    case "link":
      return "Ссылка";
    case "video":
      return "Видео";
    default:
      return format.toUpperCase();
  }
}

function MaterialSheet({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const [detail, setDetail] = useState<MaterialDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialId = material?.id ?? null;

  useEffect(() => {
    if (materialId === null) {
      setDetail(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    fetchMaterial(materialId)
      .then(setDetail)
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось открыть материал")),
      )
      .finally(() => setIsLoading(false));
  }, [materialId]);

  const openFile = () => {
    const fileId = detail?.file?.id;
    if (fileId === undefined) return;

    fetchFileUrl(fileId)
      .then((url) => Linking.openURL(url))
      .catch((e: unknown) =>
        setError(errorText(e, "Не удалось получить ссылку на файл")),
      );
  };

  return (
    <Modal visible={material !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={[styles.sheet, styles.readerSheet]}>
          <View style={styles.sheetHandle} />
          <Text style={shared.cardTitle}>{material?.title ?? ""}</Text>
          <Text style={shared.cardMeta}>{formatLabel(detail?.format ?? material?.format ?? "")}</Text>

          {isLoading ? <ActivityIndicator color={colors.blue} style={{ marginTop: 16 }} /> : null}
          {error ? <Text style={shared.errorText}>{error}</Text> : null}

          <ScrollView style={styles.readerScroll} showsVerticalScrollIndicator={false}>
            {detail?.body_blocks === null || detail?.body_blocks === undefined ? null : (
              <LessonReader blocks={detail.body_blocks} />
            )}

            {detail?.external_url === null || detail?.external_url === undefined ? null : (
              <Pressable
                accessibilityRole="link"
                onPress={() => void Linking.openURL(detail.external_url ?? "")}
                style={({ pressed }) => [shared.primaryButton, pressed && shared.pressed]}
              >
                <Text style={shared.primaryButtonText}>Открыть ссылку</Text>
              </Pressable>
            )}

            {detail?.file === null || detail?.file === undefined ? null : (
              <>
                <Text style={styles.distributionNote}>
                  {detail.file.original_name} ·{" "}
                  {String(Math.max(1, Math.round(detail.file.size_bytes / 1024)))} КБ
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={openFile}
                  style={({ pressed }) => [
                    shared.primaryButton,
                    styles.sheetAction,
                    pressed && shared.pressed,
                  ]}
                >
                  <Text style={shared.primaryButtonText}>Открыть файл</Text>
                </Pressable>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

interface SendSheetProps {
  material: Material | null;
  classes: TeacherClass[];
  onClose: () => void;
  onSent: () => void;
  onError: (message: string) => void;
}

function SendSheet({ material, classes, onClose, onSent, onError }: SendSheetProps) {
  const [classId, setClassId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [isSending, setIsSending] = useState(false);

  const target = classId ?? classes[0]?.id ?? null;

  const send = () => {
    if (material === null || target === null || isSending) return;

    setIsSending(true);
    apiPost("/v1/distributions", {
      material_id: material.id,
      class_id: target,
      ...(note.trim() === "" ? {} : { message_md: note.trim() }),
    })
      .then(() => {
        setNote("");
        setClassId(null);
        onSent();
      })
      .catch((e: unknown) =>
        onError(errorText(e, "Не удалось отправить материал")),
      )
      .finally(() => setIsSending(false));
  };

  return (
    <Modal visible={material !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetLayer}>
        <Pressable style={styles.sheetBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={shared.cardTitle}>Отправить: {material?.title ?? ""}</Text>

          <Text style={shared.fieldLabel}>КОМУ</Text>
          <View style={styles.classRow}>
            {classes.map((item) => {
              const active = item.id === target;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  onPress={() => setClassId(item.id)}
                  style={[styles.classChip, active && styles.classChipActive]}
                >
                  <Text style={[styles.classChipText, active && styles.classChipTextActive]}>
                    {item.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Сопроводительное сообщение (необязательно)"
            multiline
            style={[shared.input, styles.noteInput]}
          />

          <Pressable
            accessibilityRole="button"
            disabled={target === null || isSending}
            onPress={send}
            style={({ pressed }) => [
              shared.primaryButton,
              styles.sheetAction,
              (target === null || isSending) && shared.disabled,
              pressed && shared.pressed,
            ]}
          >
            <Text style={shared.primaryButtonText}>Отправить</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  formActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 18,
    marginTop: 18,
  },
  sendAction: { marginTop: 14, alignSelf: "flex-start" },
  attachButton: { marginTop: 10 },
  progressTrack: {
    marginTop: 8,
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    backgroundColor: colors.border,
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.blue },
  deleteAction: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  deleteActionText: { color: colors.orange, fontSize: 13, fontWeight: "800" },
  attachHint: { marginTop: 6, color: colors.muted, fontSize: 12 },
  openHint: { marginTop: 8, color: colors.blue, fontSize: 12, fontWeight: "800" },
  readerSheet: { maxHeight: "82%" },
  readerScroll: { marginTop: 12 },
  sectionTitle: { marginTop: 28, color: colors.text, fontSize: 20, fontWeight: "900" },
  distributionNote: { marginTop: 8, color: colors.muted, fontSize: 14, lineHeight: 20 },
  sheetLayer: { flex: 1, justifyContent: "flex-end" },
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.24)" },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: colors.card,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  sheetHandle: {
    width: 48,
    height: 5,
    borderRadius: 3,
    alignSelf: "center",
    backgroundColor: colors.border,
    marginBottom: 16,
  },
  classRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  classChip: {
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  classChipActive: { borderColor: colors.navy, backgroundColor: colors.navy },
  classChipText: { color: colors.muted, fontSize: 13, fontWeight: "800" },
  classChipTextActive: { color: "#ffffff" },
  noteInput: { minHeight: 84, textAlignVertical: "top" },
  sheetAction: { marginTop: 18 },
});
