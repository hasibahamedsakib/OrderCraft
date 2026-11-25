import { createSlice } from '@reduxjs/toolkit';
import {
  AssistantError,
  ERROR_MESSAGES,
  askAssistant as callAssistant,
  geminiConfigFromEnv,
  type AssistantErrorKind,
} from '../../assistant/gemini';
import { zonedDate } from '../../domain/time';
import { estimateServerNow } from '../../app/serverTime';
import { selectPaymentMethodLabel } from '../selectors/menuSelectors';
import { createAppAsyncThunk, fetchOrders } from '../thunks';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  tool?: { name: string; args: Record<string, unknown> };
  phrasedBy?: 'gemini' | 'code';
  note?: string;
  error?: { kind: AssistantErrorKind; question: string };
}

export interface ChatState {
  messages: ChatMessage[];
  pending: boolean;
}

const initialState: ChatState = { messages: [], pending: false };

let messageCounter = 0;
const nextId = () => `msg-${Date.now().toString(36)}-${++messageCounter}`;

export const askAssistant = createAppAsyncThunk<
  Awaited<ReturnType<typeof callAssistant>>,
  { question: string; retryOf?: string },
  { rejectValue: { kind: AssistantErrorKind; message: string } }
>(
  'chat/ask',
  async ({ question }, thunk) => {
    if (thunk.getState().orders.status !== 'succeeded') await thunk.dispatch(fetchOrders());
    const state = thunk.getState(); // read orders at question time: new checkouts count immediately
    const timeZone = state.menu.data?.timeZone ?? 'UTC';
    try {
      return await callAssistant(
        question,
        {
          orders: state.orders.items,
          menu: state.menu.data?.menu ?? null,
          timeZone,
          currency: state.menu.data?.currency ?? 'BDT',
          paymentMethodLabel: selectPaymentMethodLabel(state),
        },
        geminiConfigFromEnv(),
        zonedDate(estimateServerNow(state.clock.offsetMs), timeZone),
        thunk.signal,
      );
    } catch (error) {
      const kind: AssistantErrorKind = error instanceof AssistantError ? error.kind : 'unknown';
      return thunk.rejectWithValue({ kind, message: error instanceof Error ? error.message : ERROR_MESSAGES.unknown });
    }
  },
  { condition: (_, { getState }) => !getState().chat.pending },
);

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    chatCleared(state) {
      state.messages = [];
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(askAssistant.pending, (state, { meta }) => {
        state.pending = true;
        if (meta.arg.retryOf) {
          state.messages = state.messages.filter((m) => m.id !== meta.arg.retryOf);
        } else {
          state.messages.push({ id: nextId(), role: 'user', text: meta.arg.question });
        }
      })
      .addCase(askAssistant.fulfilled, (state, { payload }) => {
        state.pending = false;
        const message: ChatMessage = { id: nextId(), role: 'assistant', text: payload.text, phrasedBy: payload.phrasedBy };
        if (payload.tool) message.tool = payload.tool;
        if (payload.note) message.note = payload.note;
        state.messages.push(message);
      })
      .addCase(askAssistant.rejected, (state, { payload, meta }) => {
        state.pending = false;
        const kind = payload?.kind ?? 'unknown';
        state.messages.push({
          id: nextId(),
          role: 'assistant',
          text: payload?.message ?? ERROR_MESSAGES.unknown,
          error: { kind, question: meta.arg.question },
        });
      });
  },
});

export const { chatCleared } = chatSlice.actions;
export default chatSlice.reducer;
