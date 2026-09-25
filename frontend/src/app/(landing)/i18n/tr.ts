import type { LandingDictionary } from './types';

/** Turkish landing copy. Generated from docs/design/QUBERTY_LANDING_2026-09-25.md §6. */
export const tr: LandingDictionary = {
  meta: {
    title: 'Quberty ERP — tüm işiniz için tek sistem',
    description:
      'Satış, satın alma, stok, depo ve finans tek yerde; aynı defterlere yazan bir satış noktası ve online mağaza ile. 5–50 kişilik işletmeler için tasarlandı.',
  },
  nav: { product: 'Ürün', capabilities: 'Özellikler', how: 'Nasıl çalışır', signIn: 'Giriş yap', demo: 'Demo talep et', languageLabel: 'Dil' },
  hero: {
    eyebrow: 'Büyüyen işletmeler için ERP',
    title: 'Tüm işinizi tek bir sistemden yönetin.',
    subtitle:
      'Quberty satışı, satın almayı, stoğu, depoyu ve finansı bir araya getirir; satış noktanız ve online mağazanız da aynı defterlere yazar. 5 ile 50 kişilik ekipler için.',
    primary: 'Demo talep et',
    secondary: 'Nasıl çalıştığını gör',
    proof: ['Tüm mağazalarda tek stok rakamı', 'Kendiliğinden kapanan defterler', 'Aylarca değil, günler içinde kurulum'],
  },
  problem: {
    title: 'Tanıdık geliyor mu?',
    intro: 'Büyüyen işletmelerin çoğu, beş kişiyken işleyen ama yirmi kişide dağılan bir yama bohçasıyla yürür.',
    items: [
      { title: 'Her yerde Excel', body: 'Siparişler bir dosyada, stok başka birinde, fiyatlar birinin aklında. Her rapor kopyala-yapıştırla başlar.' },
      { title: 'Güvenilmeyen stok', body: 'Raf bir şey söyler, sistem başka bir şey; online mağaza artık elinizde olmayanı satar.' },
      { title: 'Haftalar süren ay sonu', body: 'Satışlar ve alımlar muhasebeye hiç düzgün ulaşmadığı için muhasebeci defterleri fişlerden yeniden kurar.' },
    ],
  },
  oneSystem: {
    title: 'Tek sistem. Her kanal.',
    intro: 'Merkez ofisiniz, mağazalarınız, web mağazanız ve deponuz — aynı veriyle, anlık olarak çalışır.',
    tiles: [
      { title: 'Merkez ofis', body: 'Satış, satın alma, finans ve personel.' },
      { title: 'Satış noktası', body: 'Her mağaza için hızlı bir kasa uygulaması.' },
      { title: 'Online mağaza', body: 'Aynı katalog ve aynı stokla online satış.' },
      { title: 'Depo', body: 'Yönlendirmeli işlerle kabul, yerleştirme, toplama ve sevk.' },
    ],
    ledgerLine: 'Her satış, her mal kabul ve her ödeme aynı stoğa ve aynı defterlere düşer — dışa aktarma yok, yeniden yazma yok.',
  },
  capabilities: {
    title: 'İhtiyacınız olan her şey. Fazlası değil.',
    intro: 'Ciddi bir ERP’nin çekirdeği; BT departmanı olmayan bir işletmeye göre şekillendirildi.',
    items: [
      { title: 'Müşteriler', body: 'İlk temastan imzalı teklife kadar.', includes: ['Potansiyel müşteriler ve kişiler', 'Teklifler', 'Müşteri geçmişi'] },
      { title: 'Satış', body: 'Doğrudan stoğa ve faturaya akan siparişler.', includes: ['Satış siparişleri', 'Faturalama', 'Müşteri bakiyeleri'] },
      { title: 'Satın alma', body: 'Zamanında ve doğru fiyata satın alın.', includes: ['Satın alma talepleri', 'Satın alma siparişleri', 'Tedarikçi faturaları'] },
      { title: 'Depo', body: 'Her ürünün nerede olduğunu bilin ve amaçla taşıyın.', includes: ['Mal kabul ve yerleştirme', 'Toplama dalgaları', 'Raf lokasyonları'] },
      { title: 'Finans', body: 'Kasa defteri değil, gerçek çift taraflı muhasebe.', includes: ['Yevmiye ve dönemler', 'Banka mutabakatı', 'Gelir tablosu ve bilanço'] },
      { title: 'Personel', body: 'Ekibiniz, rolleri ve erişimleri.', includes: ['Çalışanlar', 'Roller ve yetkiler', 'Mağaza atamaları'] },
      { title: 'Raporlar', body: 'İhtiyacınız olan rakamlar, kurmakla uğraşmadan.', includes: ['Yönetici paneli', 'Satış ve stok raporları', 'Alacak ve borç yaşlandırma'] },
      { title: 'Kontrol', body: 'Kimin neyi ne zaman değiştirdiğini görün.', includes: ['Tam denetim izi', 'Onaya hazır belgeler', 'Veri aktarımı'] },
    ],
  },
  flows: {
    title: 'İş nasıl akar',
    intro: 'Her belge nereden geldiğini ve nereye gideceğini bilir. Hiçbir şey iki kez yazılmaz.',
    selling: {
      label: 'Satış',
      steps: ['Potansiyel müşteri', 'Teklif', 'Sipariş', 'Toplama ve sevk', 'Fatura', 'Tahsilat'],
      note: 'Teklif siparişe dönüşür, sipariş stoğu ayırır, fatura kendini deftere işler.',
    },
    buying: {
      label: 'Satın alma',
      steps: ['Talep', 'Satın alma siparişi', 'Mal kabul', 'Yerleştirme', 'Tedarikçi faturası', 'Ödeme'],
      note: 'Ne teslim aldıysanız onun parasını ödersiniz — fatura ödenmeden önce siparişle eşleştirilir.',
    },
  },
  foundation: {
    title: 'Yüzeyde sade. Altında ciddi.',
    intro: 'Quberty’ye başlamak kolaydır ve kurumsal sistemlerle aynı temeller üzerine kuruludur — bir daha sistem değiştirmek zorunda kalmazsınız.',
    items: [
      { title: 'Gerçek muhasebe', body: 'Her işlem, muhasebecinizin güvenebileceği dengeli bir yevmiye kaydıdır.' },
      { title: 'Sizinle büyür', body: 'Bugün ihtiyacınız olanla başlayın; gerektiğinde fazlasını açın, veri taşımadan.' },
      { title: 'Çok mağaza, tek görünüm', body: 'Birden çok mağaza ve depoyu, her biri ve işin tamamı için stok ve sonuçlarla yönetin.' },
      { title: 'Hiçbir şey kaybolmaz', body: 'Düzeltmeler silinmez, kaydedilir. Ne olduğunu her zaman görebilirsiniz.' },
    ],
  },
  finalCta: {
    title: 'Quberty’yi kendi verinizle görün.',
    body: '30 dakikalık bir tanıtım ayarlayın. Gününüzü Quberty’de gösterelim — siparişler, stok ve defterler.',
    primary: 'Demo talep et',
  },
  footer: { rights: 'Tüm hakları saklıdır.', signIn: 'Giriş yap' },
};
