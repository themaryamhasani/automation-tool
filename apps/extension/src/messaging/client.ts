import type { BackgroundRequest, BackgroundResponse } from './contracts';

export async function sendBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(request) as Promise<BackgroundResponse>;
}
