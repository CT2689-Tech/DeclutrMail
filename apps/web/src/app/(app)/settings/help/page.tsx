import { editorialColumnStyle } from '@/features/editorial/page';
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
          ...editorialColumnStyle,
          paddingTop: 0,
        }}
      >
        <ContactSupportForm />
      </div>
    </>
  );
}
