import { defineStore } from 'pinia';

export const useUi = defineStore('ui', {
  state: () => ({
    forbidden: null as null | { screen: string; title: string },
    unread: 0,
  }),
});
