import { HomeFixDialog } from './home-fix-dialog';

export default {
  title: 'Home/FixDialog',
  component: HomeFixDialog,
  parameters: { layout: 'fullscreen' },
};

export const Review = {
  args: {
    step: { kind: 'unsub_archive', senderCount: 2, emailCount: 480, senderIds: ['s-1', 's-2'] },
    onCancel: () => {},
    onConfirm: () => {},
  },
};
