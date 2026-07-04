/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** NPC 对话 / 讲故事的后端中转端点（前端不再持 StepFun key） */
  readonly VITE_CHAT_RELAY_URL: string;
  /** 探险相册生图的后端中转端点（前端不再持火山方舟 key） */
  readonly VITE_IMAGE_RELAY_URL: string;
  readonly VITE_OTTERLANTIS_ASSET_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
