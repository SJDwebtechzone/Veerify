import { Shield, FileText, RefreshCcw, HeartPulse, Users, CheckCircle2 } from 'lucide-react';

function LegalLayout({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[#0B1020] text-white overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,#7c3aed33,transparent_35%),radial-gradient(circle_at_bottom_left,#2563eb33,transparent_35%)]" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-10 md:py-16">
        <div className="grid lg:grid-cols-[280px_1fr] gap-8">
          <aside className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-6 h-fit sticky top-6">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
                {icon}
              </div>
              <div>
                <h2 className="text-xl font-bold">Legal Center</h2>
                <p className="text-sm text-gray-400">Martial Arts Academy</p>
              </div>
            </div>

            <nav className="space-y-3 text-sm">
              <div className="flex items-center gap-3 bg-white/10 border border-white/10 rounded-2xl px-4 py-3">
                <Shield size={18} /> Privacy Policy
              </div>
              <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3 text-gray-300">
                <FileText size={18} /> Terms & Conditions
              </div>
              <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3 text-gray-300">
                <RefreshCcw size={18} /> Refund Policy
              </div>
              <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3 text-gray-300">
                <Users size={18} /> Child Safety
              </div>
              <div className="flex items-center gap-3 bg-white/5 rounded-2xl px-4 py-3 text-gray-300">
                <HeartPulse size={18} /> Medical Disclaimer
              </div>
            </nav>
          </aside>

          <section className="bg-white text-gray-800 rounded-[32px] shadow-2xl overflow-hidden border border-white/10">
            <div className="bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 px-8 py-12 text-white relative overflow-hidden">
              <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
              <div className="absolute right-20 bottom-0 w-28 h-28 bg-cyan-300/10 rounded-full blur-xl" />

              <div className="relative z-10 max-w-3xl">
                <div className="inline-flex items-center gap-2 bg-white/10 border border-white/10 rounded-full px-4 py-2 text-sm mb-5 backdrop-blur-md">
                  {icon}
                  Academy Legal Documentation
                </div>

                <h1 className="text-4xl md:text-5xl font-black leading-tight mb-4 tracking-tight">
                  {title}
                </h1>

                <p className="text-lg text-white/85 leading-8 max-w-2xl">
                  {subtitle}
                </p>
              </div>
            </div>

            <div className="p-8 md:p-12 space-y-8">
              {children}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function LegalCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-gradient-to-br from-gray-50 to-white border border-gray-200 rounded-3xl p-6 shadow-sm hover:shadow-lg transition-all duration-300">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
          <CheckCircle2 className="text-violet-600" size={20} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
      </div>

      <div className="text-gray-600 leading-8 text-[15px]">
        {children}
      </div>
    </div>
  );
}

// app/legal/privacy-policy/page.tsx
export function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Learn how we collect, protect, and manage your information while using our martial arts academy platform and subscription services."
      icon={<Shield size={22} />}
    >
      <LegalCard title="Information We Collect">
        <ul className="space-y-3">
          <li>• Name, phone number, and email address</li>
          <li>• Attendance and belt progression records</li>
          <li>• Subscription and payment history</li>
          <li>• Course enrollments and certificates</li>
        </ul>
      </LegalCard>

      <LegalCard title="How We Use Data">
        <ul className="space-y-3">
          <li>• To manage academy operations and class schedules</li>
          <li>• To process recurring subscriptions and payments</li>
          <li>• To issue certificates and belt promotions</li>
          <li>• To provide important updates and notifications</li>
        </ul>
      </LegalCard>

      <LegalCard title="Payment Security">
        <p>
          Payments are securely processed through trusted third-party payment
          gateways. We do not store card details or banking information on our
          servers.
        </p>
      </LegalCard>

      <LegalCard title="Contact Information">
        <p>
          support@youracademy.com
          <br />
          +91 9876543210
        </p>
      </LegalCard>
    </LegalLayout>
  );
}

// ------------------------------------------------------------
// app/legal/terms-and-conditions/page.tsx
export function TermsAndConditionsPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Learn how we collect, protect, and manage your information while using our martial arts academy platform and subscription services."
      icon={<Shield size={22} />}
    >
      <LegalCard title="Information We Collect">
        <ul className="space-y-3">
          <li>• Name, phone number, and email address</li>
          <li>• Attendance and belt progression records</li>
          <li>• Subscription and payment history</li>
          <li>• Course enrollments and certificates</li>
        </ul>
      </LegalCard>

      <LegalCard title="How We Use Data">
        <ul className="space-y-3">
          <li>• To manage academy operations and class schedules</li>
          <li>• To process recurring subscriptions and payments</li>
          <li>• To issue certificates and belt promotions</li>
          <li>• To provide important updates and notifications</li>
        </ul>
      </LegalCard>

      <LegalCard title="Payment Security">
        <p>
          Payments are securely processed through trusted third-party payment
          gateways. We do not store card details or banking information on our
          servers.
        </p>
      </LegalCard>

      <LegalCard title="Contact Information">
        <p>
          support@youracademy.com
          <br />
          +91 9876543210
        </p>
      </LegalCard>
    </LegalLayout>
  );
}

// ------------------------------------------------------------
// app/legal/refund-policy/page.tsx
export function RefundPolicyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Learn how we collect, protect, and manage your information while using our martial arts academy platform and subscription services."
      icon={<Shield size={22} />}
    >
      <LegalCard title="Information We Collect">
        <ul className="space-y-3">
          <li>• Name, phone number, and email address</li>
          <li>• Attendance and belt progression records</li>
          <li>• Subscription and payment history</li>
          <li>• Course enrollments and certificates</li>
        </ul>
      </LegalCard>

      <LegalCard title="How We Use Data">
        <ul className="space-y-3">
          <li>• To manage academy operations and class schedules</li>
          <li>• To process recurring subscriptions and payments</li>
          <li>• To issue certificates and belt promotions</li>
          <li>• To provide important updates and notifications</li>
        </ul>
      </LegalCard>

      <LegalCard title="Payment Security">
        <p>
          Payments are securely processed through trusted third-party payment
          gateways. We do not store card details or banking information on our
          servers.
        </p>
      </LegalCard>

      <LegalCard title="Contact Information">
        <p>
          support@youracademy.com
          <br />
          +91 9876543210
        </p>
      </LegalCard>
    </LegalLayout>
  );
}

// ------------------------------------------------------------
// app/legal/child-safety/page.tsx
export function ChildSafetyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Learn how we collect, protect, and manage your information while using our martial arts academy platform and subscription services."
      icon={<Shield size={22} />}
    >
      <LegalCard title="Information We Collect">
        <ul className="space-y-3">
          <li>• Name, phone number, and email address</li>
          <li>• Attendance and belt progression records</li>
          <li>• Subscription and payment history</li>
          <li>• Course enrollments and certificates</li>
        </ul>
      </LegalCard>

      <LegalCard title="How We Use Data">
        <ul className="space-y-3">
          <li>• To manage academy operations and class schedules</li>
          <li>• To process recurring subscriptions and payments</li>
          <li>• To issue certificates and belt promotions</li>
          <li>• To provide important updates and notifications</li>
        </ul>
      </LegalCard>

      <LegalCard title="Payment Security">
        <p>
          Payments are securely processed through trusted third-party payment
          gateways. We do not store card details or banking information on our
          servers.
        </p>
      </LegalCard>

      <LegalCard title="Contact Information">
        <p>
          support@youracademy.com
          <br />
          +91 9876543210
        </p>
      </LegalCard>
    </LegalLayout>
  );
}

// ------------------------------------------------------------
// app/legal/medical-disclaimer/page.tsx
export default function MedicalDisclaimerPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      subtitle="Learn how we collect, protect, and manage your information while using our martial arts academy platform and subscription services."
      icon={<Shield size={22} />}
    >
      <LegalCard title="Information We Collect">
        <ul className="space-y-3">
          <li>• Name, phone number, and email address</li>
          <li>• Attendance and belt progression records</li>
          <li>• Subscription and payment history</li>
          <li>• Course enrollments and certificates</li>
        </ul>
      </LegalCard>

      <LegalCard title="How We Use Data">
        <ul className="space-y-3">
          <li>• To manage academy operations and class schedules</li>
          <li>• To process recurring subscriptions and payments</li>
          <li>• To issue certificates and belt promotions</li>
          <li>• To provide important updates and notifications</li>
        </ul>
      </LegalCard>

      <LegalCard title="Payment Security">
        <p>
          Payments are securely processed through trusted third-party payment
          gateways. We do not store card details or banking information on our
          servers.
        </p>
      </LegalCard>

      <LegalCard title="Contact Information">
        <p>
          support@youracademy.com
          <br />
          +91 9876543210
        </p>
      </LegalCard>
    </LegalLayout>
  );
}
