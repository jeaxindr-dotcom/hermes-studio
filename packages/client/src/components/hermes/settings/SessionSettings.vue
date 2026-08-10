<script setup lang="ts">
import { watch } from "vue";
import { NInputNumber, NSelect, NSwitch, useDialog, useMessage } from "naive-ui";
import { useI18n } from "vue-i18n";
import { useSettingsStore } from "@/stores/hermes/settings";
import { useProfilesStore } from "@/stores/hermes/profiles";
import type { ApprovalMode } from "@/api/hermes/config";
import { useSessionBrowserPrefsStore } from "@/stores/hermes/session-browser-prefs";
import SettingRow from "./SettingRow.vue";

const settingsStore = useSettingsStore();
const profilesStore = useProfilesStore();
const sessionBrowserPrefsStore = useSessionBrowserPrefsStore();
const message = useMessage();
const dialog = useDialog();
const { t } = useI18n();

let approvalSaveQueue: Promise<void> = Promise.resolve();
let approvalRequestId = 0;
let committedApprovalMode: ApprovalMode | null = null;
let approvalProfileKey = profilesStore.activeProfileName || 'default';

function currentApprovalProfileKey() {
  return profilesStore.activeProfileName || 'default';
}

function normalizeApprovalMode(value: unknown): ApprovalMode {
  return value === 'manual' || value === 'off' ? value : 'smart';
}

watch(() => profilesStore.activeProfileName, () => {
  approvalRequestId += 1;
  committedApprovalMode = null;
  approvalProfileKey = currentApprovalProfileKey();
});

// 防抖保存：每个字段独立定时器，300ms 内只发最后一次 HTTP 请求
const debounceTimers: Record<string, ReturnType<typeof setTimeout>> = {};

function save(values: Record<string, any>) {
  // NSelect/NSwitch 等一次性操作，直接保存，不需要防抖
  settingsStore.updateLocal('session_reset', values)
  settingsStore.saveSection('session_reset', values).then(() => {
    message.success(t("settings.saved"));
  }).catch(() => {
    message.error(t("settings.saveFailed"));
  });
}

function debouncedSave(key: string, value: any) {
  // 先立即更新本地 store（UI 即时响应）
  settingsStore.updateLocal('session_reset', { [key]: value });
  // 再防抖发 HTTP 保存
  if (debounceTimers[key]) clearTimeout(debounceTimers[key])
  debounceTimers[key] = setTimeout(async () => {
    try {
      await settingsStore.saveSection('session_reset', { [key]: value });
      message.success(t("settings.saved"));
    } catch (err: any) {
      message.error(t("settings.saveFailed"));
    }
  }, 300);
}

async function toggleRequireAuth(value: boolean) {
  if (!value) {
    dialog.warning({
      title: t('chat.authorizationMode.fullAccessTitle'),
      content: t('chat.authorizationMode.fullAccessConfirm'),
      positiveText: t('chat.authorizationMode.enableFullAccess'),
      negativeText: t('common.cancel'),
      onPositiveClick: () => {
        void saveApprovalMode('off')
        return true
      },
    })
    return
  }
  await saveApprovalMode('manual')
}

async function saveApprovalMode(mode: 'manual' | 'off') {
  const profileKey = currentApprovalProfileKey();
  if (profileKey !== approvalProfileKey) {
    approvalRequestId += 1;
    committedApprovalMode = null;
    approvalProfileKey = profileKey;
  }
  const requestId = ++approvalRequestId;
  const baseline = committedApprovalMode ?? normalizeApprovalMode(settingsStore.approvals.mode);
  if (committedApprovalMode === null) committedApprovalMode = baseline;
  settingsStore.updateLocal('approvals', { mode });

  approvalSaveQueue = approvalSaveQueue.then(async () => {
    if (profileKey !== currentApprovalProfileKey()) return;
    try {
      await settingsStore.saveSection('approvals', { mode }, {
        shouldCommit: () => profileKey === currentApprovalProfileKey(),
      });
      if (profileKey !== currentApprovalProfileKey()) return;
      committedApprovalMode = mode;
      if (requestId === approvalRequestId) message.success(t("settings.saved"));
    } catch (err: any) {
      if (requestId === approvalRequestId && profileKey === currentApprovalProfileKey()) {
        settingsStore.updateLocal('approvals', { mode: committedApprovalMode ?? baseline });
        message.error(t("settings.saveFailed"));
      }
    }
  });
  await approvalSaveQueue;
}

async function toggleWriteApproval(section: "memory" | "skills", value: boolean) {
  try {
    settingsStore.updateLocal(section, { write_approval: value });
    await settingsStore.saveSection(section, { write_approval: value });
    message.success(t("settings.saved"));
  } catch (err: any) {
    message.error(t("settings.saveFailed"));
  }
}

</script>

<template>
  <section class="settings-section">
    <SettingRow
      :label="t('settings.session.requireAuth')"
      :hint="t('settings.session.requireAuthHint')"
    >
      <NSwitch :value="settingsStore.approvals.mode !== 'off'" @update:value="toggleRequireAuth" />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.memoryWriteApproval')"
      :hint="t('settings.session.memoryWriteApprovalHint')"
    >
      <NSwitch
        :value="settingsStore.memory.write_approval === true"
        @update:value="(value) => toggleWriteApproval('memory', value)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.skillsWriteApproval')"
      :hint="t('settings.session.skillsWriteApprovalHint')"
    >
      <NSwitch
        :value="settingsStore.skills.write_approval === true"
        @update:value="(value) => toggleWriteApproval('skills', value)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.mode')"
      :hint="t('settings.session.modeHint')"
    >
      <NSelect
        :value="settingsStore.sessionReset.mode || 'both'"
        :options="[
          { label: t('settings.session.modeBoth'), value: 'both' },
          { label: t('settings.session.modeIdle'), value: 'idle' },
          { label: t('settings.session.modeDaily'), value: 'daily' },
          { label: t('settings.session.modeNone'), value: 'none' },
        ]"
        size="small"
        class="input-md"
        @update:value="(v) => save({ mode: v })"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.idleMinutes')"
      :hint="t('settings.session.idleMinutesHint')"
    >
      <NInputNumber
        :value="settingsStore.sessionReset.idle_minutes"
        :min="10"
        :max="10080"
        :step="30"
        size="small"
        class="input-sm"
        @update:value="(v) => v != null && debouncedSave('idle_minutes', v)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.atHour')"
      :hint="t('settings.session.atHourHint')"
    >
      <NInputNumber
        :value="settingsStore.sessionReset.at_hour"
        :min="0"
        :max="23"
        :step="1"
        size="small"
        class="input-sm"
        @update:value="(v) => v != null && debouncedSave('at_hour', v)"
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.session.liveMonitorHumanOnly')"
      :hint="t('settings.session.liveMonitorHumanOnlyHint')"
    >
      <NSwitch
        :value="sessionBrowserPrefsStore.humanOnly"
        @update:value="(value) => sessionBrowserPrefsStore.setHumanOnly(value)"
      />
    </SettingRow>
  </section>
</template>

<style scoped lang="scss">
@use "@/styles/variables" as *;

.settings-section {
  margin-top: 16px;
}
</style>
