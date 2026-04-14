import Link from 'next/link';
import { Instagram, MapPin, Phone, Mail } from 'lucide-react';

export function StoreFooter() {
  return (
    <footer className="bg-[#111111] text-gray-400 mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
          {/* Brand */}
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-1 mb-3">
              <span className="text-white font-black text-xl tracking-tight">SCARPE</span>
              <span className="text-[#C65306] font-black text-xl tracking-tight">CALZADOS</span>
            </div>
            <p className="text-sm leading-relaxed mb-4 max-w-xs">
              Premium footwear for every occasion. Style meets comfort in every step.
            </p>
            <a
              href="https://instagram.com/scarpecalzados"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-[#C65306] hover:text-[#e06010] transition-colors"
            >
              <Instagram className="h-4 w-4" />
              @scarpecalzados
            </a>
          </div>

          {/* Quick Links */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">Shop</h4>
            <ul className="space-y-2">
              {['New Arrivals', 'Sneakers', 'Boots', 'Sandals', 'Sale'].map((item) => (
                <li key={item}>
                  <Link href="/shop" className="text-sm hover:text-white transition-colors">{item}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-white font-semibold text-sm mb-4 uppercase tracking-wider">Contact</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2 text-sm">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-[#C65306]" />
                <span>La Paz, Bolivia</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Phone className="h-4 w-4 shrink-0 text-[#C65306]" />
                <span>+591 2 XXX-XXXX</span>
              </li>
              <li className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 shrink-0 text-[#C65306]" />
                <span>info@scarpecalzados.com</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="border-t border-white/10 pt-6 flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-xs">© {new Date().getFullYear()} Scarpe Calzados. All rights reserved.</p>
          <p className="text-xs">Precios incluyen IVA 13%</p>
        </div>
      </div>
    </footer>
  );
}
