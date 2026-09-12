<template>
  <section class="card bg-base-100 border-base-300/60 border">
    <div class="card-body gap-3 p-4 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 class="text-base font-semibold">订阅分享</h2>
          <p class="text-base-content/55 mt-1 text-xs">生成可供其他设备或代理软件直接使用的订阅链接</p>
        </div>
        <button type="button" class="btn btn-primary btn-sm" @click="openCreate">
          <PlusIcon class="h-4 w-4" /> 添加
        </button>
      </div>

      <div v-if="!shares.length" class="text-base-content/55 py-3 text-center text-sm">
        暂无订阅分享，点击右上角“添加”创建
      </div>
      <div v-else class="divide-base-content/10 divide-y">
        <div v-for="share in shares" :key="share.id" class="flex flex-wrap items-center gap-3 py-3 first:pt-1 last:pb-1">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{{ share.name }}</div>
          <div class="text-base-content/55 mt-1 truncate font-mono text-xs">{{ shareUrl(share) }}</div>
          <div class="text-base-content/45 mt-1 text-xs">{{ selectedNames(share).join('、') }}</div>
        </div>
        <div class="flex items-center gap-1">
          <button type="button" class="btn btn-ghost btn-sm btn-square" title="二维码" @click="openQr(share)"><QrCodeIcon class="h-4 w-4" /></button>
          <button type="button" class="btn btn-ghost btn-sm btn-square" title="复制链接" @click="copy(shareUrl(share))"><ClipboardDocumentIcon class="h-4 w-4" /></button>
          <button type="button" class="btn btn-ghost btn-sm btn-square" title="重新生成" :disabled="busy" @click="regenerate(share)"><ArrowPathIcon class="h-4 w-4" /></button>
          <button type="button" class="btn btn-ghost btn-sm btn-square" title="编辑" @click="openEdit(share)"><PencilSquareIcon class="h-4 w-4" /></button>
          <button type="button" class="btn btn-ghost btn-sm btn-square hover:text-error" title="删除" @click="remove(share)"><TrashIcon class="h-4 w-4" /></button>
        </div>
        </div>
      </div>
    </div>
  </section>

  <DialogWrapper v-model="dialogOpen" :title="editing ? '编辑订阅分享' : '新增订阅分享'" box-class="w-full max-w-3xl">
    <div class="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(280px,0.9fr)]">
      <div class="flex min-h-0 flex-col gap-2">
        <div class="text-sm font-medium">选择要分享的订阅节点</div>
        <div class="max-h-80 overflow-y-auto pr-1">
          <label v-for="sub in subscriptions" :key="sub.id" class="border-base-content/10 mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <input v-model="form.subscriptionIds" type="checkbox" class="checkbox checkbox-sm" :value="sub.id" />
            <span class="min-w-0 flex-1 truncate">{{ sub.name }}</span><span class="text-base-content/50 text-xs">{{ sub.nodeCount }} 个节点</span>
          </label>
        </div>
        <p v-if="!subscriptions.length" class="text-base-content/55 text-xs">请先添加至少一条订阅</p>
      </div>
      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm"><span>标题</span><input v-model="form.name" class="input input-sm w-full" placeholder="例如：手机代理订阅" /></label>
        <label class="flex flex-col gap-1 text-sm"><span>域名或 IP</span><input v-model="form.host" class="input input-sm w-full font-mono" placeholder="当前地址" /></label>
        <div class="border-base-content/10 flex flex-col items-center gap-3 rounded-lg border p-3">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="订阅分享二维码" class="h-40 w-40" />
          <div class="flex w-full gap-2"><input :value="displayUrl" readonly class="input input-sm min-w-0 flex-1 font-mono text-xs" /><button type="button" class="btn btn-sm" @click="copy(displayUrl)">复制</button></div>
          <p v-if="!generatedShare" class="text-base-content/50 text-xs">保存后此地址和二维码生效</p>
        </div>
        <div class="flex justify-end gap-2 pt-1"><button type="button" class="btn btn-sm" @click="dialogOpen = false">取消</button><button type="button" class="btn btn-primary btn-sm" :disabled="busy" @click="save"><span v-if="busy" class="loading loading-spinner loading-xs" />保存并生成</button></div>
      </div>
    </div>
  </DialogWrapper>
</template>

<script setup lang="ts">
import QRCode from 'qrcode'
import { computed, reactive, ref, watch } from 'vue'
import DialogWrapper from '@/components/common/DialogWrapper.vue'
import type { OpenboxSubscription, OpenboxSubscriptionShare } from '@/api/openbox'
import { createSubscriptionShare, deleteSubscriptionShare, regenerateSubscriptionShare, updateSubscriptionShare } from '@/api/openbox'
import { showNotification } from '@/helper/notification'
import { ArrowPathIcon, ClipboardDocumentIcon, PencilSquareIcon, PlusIcon, QrCodeIcon, TrashIcon } from '@heroicons/vue/24/outline'

const props = defineProps<{ subscriptions: OpenboxSubscription[]; shares: OpenboxSubscriptionShare[] }>()
const emit = defineEmits<{ changed: [] }>()
const dialogOpen = ref(false)
const editing = ref<OpenboxSubscriptionShare | null>(null)
const generatedShare = ref<OpenboxSubscriptionShare | null>(null)
const qrDataUrl = ref('')
const draftToken = ref('')
const busy = ref(false)
const form = reactive({ name: '', host: '', subscriptionIds: [] as string[] })
const currentHost = () => window.location.host
const shareUrl = (share: OpenboxSubscriptionShare) => `${window.location.protocol}//${share.host || currentHost()}/sub/${share.token}`
const displayUrl = computed(() => generatedShare.value ? shareUrl(generatedShare.value) : `${window.location.protocol}//${form.host || currentHost()}/sub/${draftToken.value}`)
const makeDraftToken = () => {
  try {
    if (window.crypto?.getRandomValues) {
      const bytes = new Uint8Array(24)
      window.crypto.getRandomValues(bytes)
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* HTTP 页面或旧浏览器可能没有 Web Crypto */ }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`
}
const selectedNames = (share: OpenboxSubscriptionShare) => (Array.isArray(share.subscriptionIds) ? share.subscriptionIds : []).map((id) => props.subscriptions.find((s) => s.id === id)?.name || id)
const reset = () => { form.name = ''; form.host = currentHost(); form.subscriptionIds = []; editing.value = null; generatedShare.value = null; draftToken.value = makeDraftToken(); qrDataUrl.value = '' }
const openCreate = () => { reset(); dialogOpen.value = true }
const openEdit = (share: OpenboxSubscriptionShare) => { reset(); editing.value = share; form.name = share.name; form.host = share.host || currentHost(); form.subscriptionIds = [...share.subscriptionIds]; dialogOpen.value = true }
const makeQr = async (share: OpenboxSubscriptionShare) => { generatedShare.value = share; qrDataUrl.value = await QRCode.toDataURL(shareUrl(share), { margin: 1, width: 240 }) }
watch(() => [form.host, draftToken.value], async () => { if (!generatedShare.value && draftToken.value) qrDataUrl.value = await QRCode.toDataURL(displayUrl.value, { margin: 1, width: 240 }) })
const save = async () => {
  if (!form.name.trim() || !form.subscriptionIds.length || busy.value) return
  busy.value = true
  try {
    const share = editing.value
      ? await updateSubscriptionShare(editing.value.id, { name: form.name, host: form.host, subscriptionIds: form.subscriptionIds, regenerate: true })
      : await createSubscriptionShare({ name: form.name, host: form.host, subscriptionIds: form.subscriptionIds })
    await makeQr(share); emit('changed'); showNotification({ content: '订阅分享已保存', type: 'alert-success' })
  } catch (error) { showNotification({ content: '订阅分享保存失败', type: 'alert-error', params: { message: error instanceof Error ? error.message : String(error) } }) } finally { busy.value = false }
}
const regenerate = async (share: OpenboxSubscriptionShare) => { if (busy.value) return; busy.value = true; try { await regenerateSubscriptionShare(share.id); emit('changed') } finally { busy.value = false } }
const remove = async (share: OpenboxSubscriptionShare) => { if (busy.value || !window.confirm(`确定删除“${share.name}”？`)) return; busy.value = true; try { await deleteSubscriptionShare(share.id); emit('changed') } finally { busy.value = false } }
const openQr = async (share: OpenboxSubscriptionShare) => { reset(); editing.value = share; form.name = share.name; form.host = share.host || currentHost(); form.subscriptionIds = [...share.subscriptionIds]; await makeQr(share); dialogOpen.value = true }
const copy = async (value: string) => { try { await navigator.clipboard.writeText(value); showNotification({ content: 'copySuccess', type: 'alert-success' }) } catch { showNotification({ content: 'copyFailed', type: 'alert-error' }) } }
</script>
