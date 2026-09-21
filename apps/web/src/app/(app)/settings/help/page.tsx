import { ContactSupportForm } from '@/features/help/contact-support-form';
import { ProductGlossary } from '@/features/help/product-glossary';

export const metadata = {
  title: 'Help & Glossary — DeclutrMail',
};

export default function SettingsHelpPage() {
  return (
    <>
      <ProductGlossary />
      <div
        className="dm-settings-page"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          maxWidth: 720,
          margin: '0 auto',
          padding: '0 24px 40px',
        }}
      >
        <ContactSupportForm />
      </div>
    </>
  );
}
