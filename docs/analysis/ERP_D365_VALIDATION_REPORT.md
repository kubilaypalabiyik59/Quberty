# Quberty ERP — D365 Uyum ve Ürünleşme Doğrulama Raporu

> **Durum:** Nihai doğrulama raporu<br>
> **Tarih:** 2026-09-04<br>
> **Kapsam:** Kod, Prisma şeması, SQL geçiş dosyaları, web ERP, web POS, mobil POS ve mevcut repo dokümantasyonu<br>
> **Resmî kaynak kullanımı:** Microsoft Learn MCP proje kapsamına kuruldu; bağlantı, araç keşfi, arama ve tam sayfa fetch çağrılarıyla doğrulandı. D365’e ilişkin ana süreç, vergi, finansal boyut, depo, numara sırası, vendor invoice ve trade agreement hükümleri Microsoft Learn’in güncel içeriğiyle yeniden kontrol edildi.

## 1. Yönetici özeti

Quberty, basit bir stok ve faturalama uygulaması olmaktan çıkmış; ürün, varyant, fiziksel stok, maliyet katmanı, depo işi, P2P/O2C belge zinciri, otomatik muhasebe, finansal boyut, vergi ve belge numaralandırma temelleri olan gerçek bir ERP çekirdeğine dönüşmüştür. En güçlü tarafı, D365 davranışlarını bütünüyle kopyalamadan veri modeli anatomisini seçici biçimde almasıdır.

Bununla birlikte sistem bugün “paketlenebilir beta” ile “muhasebesel olarak tek doğruluk kaynağı olan modern ERP” arasında kalmaktadır. Dört konu ürünleşme öncesi kapı niteliğindedir:

1. **Vergi doğruluğu tek kaynak değil.** Backend motoru Bolivya IVA/IT davranışını veriyle çözerken web ve mobil istemcilerin bir bölümü eski formülleri yeniden hesaplıyor. Aynı belge için önizleme/PDF ile backend ve GL farklı sonuç gösterebilir.
2. **Tahsilat/ödeme bir alt defter modeli değil.** Satış ve satın alma belgelerinde `paid_at` bayrağı bütün bakiyeyi tek seferde kapatıyor. Kısmi ödeme, bir ödemenin birden fazla faturaya mahsubu, avans, döviz farkı ve gerçek yaşlandırma mümkün değil.
3. **Tenant izolasyonu veritabanında savunma derinliğine sahip değil.** Uygulama JWT ile tenant başlığını eşleştiriyor, fakat repoda PostgreSQL RLS politikası yok; ayrıca dört eski belge numarası hâlâ global `@unique`.
4. **Schema teslim disiplini zayıf.** 22 adet el ile çalıştırılan SQL dosyası var, fakat Prisma migration geçmişi yok. Prisma şeması ile partial index/CHECK gerçekliği arasında kontrollü sapmalar bulunuyor ve `prisma db push` bunları silebilir.

### Genel hüküm

| Boyut | Hüküm | Gerekçe |
|---|---|---|
| Süreç kapsamı | Güçlü beta | Lead→Opportunity→Quotation→Order ve Requisition→RFQ→PO zincirleri mevcut; P2P receipt/invoice ayrımı ciddi bir kazanım. |
| Veri modeli | Güçlü, fakat bazı kritik eski izler var | Boyutlar, posting profiles, date-effective tax/price ve belge kökeni iyi; ödeme/settlement ve shipment lines eksik. |
| Muhasebe çekirdeği | Orta-güçlü | Merkezi journal writer, period check, balance ve correction provenance var; fakat gerçek AR/AP settlement alt defteri yok. |
| Bolivya uygunluğu | Yüksek riskli kısmi uyum | Konfigüre edilebilir IVA/IT motoru iyi; istemci formülleri ve factura numara akışı tutarsız; hukukî açık kararlar devam ediyor. |
| Multi-tenancy | Uygulama düzeyinde iyi, DB düzeyinde eksik | JWT/header tenant eşleşmesi var; RLS yok ve bazı global benzersizlikler var. |
| UX / setup | İşlevsel ama dağınık | Geniş ekran yüzeyi mevcut; bazı canlı backend kabiliyetlerinin UI’si yok ve bazı parametreler salt okunur/inert. |
| Operasyonel hazır oluş | Beta | Kirli nested POS çalışma ağacı, formal migration zinciri ve uçtan uca vergi kontratı eksik. |

## 2. Kanıt yöntemi ve kaynak sınıfları

Bu raporda her önemli hüküm aşağıdaki sınıflardan biriyle yazılmıştır:

- **repo-verified:** Mevcut dosya ve satırlarla doğrulandı.
- **official documentation:** Microsoft Learn MCP arama ve fetch sonucu ile doğrulandı; URL hükmün yanında verildi.
- **unverified:** Resmî kaynakla bu çalışmada doğrulanamayan veya kaynağın kapsamadığı iddia.
- **architectural recommendation:** Koddan türetilen tasarım önerisi.
- **assumption needing validation:** İş/hukuk/operasyon sahibi tarafından doğrulanması gereken varsayım.

### 2.1 Microsoft Learn MCP erişim sonucu

**repo-verified:** Çalışmanın başında proje `.codex/config.toml` yalnız Prisma MCP içeriyordu. Resmî Microsoft endpoint’i proje kapsamına mevcut kaydı bozmadan eklendi:

```toml
[mcp_servers.microsoft-learn]
url = "https://learn.microsoft.com/api/mcp"
```

`codex mcp list` sonucunda hem `prisma` hem `microsoft-learn` etkin kaldı. Standart MCP `initialize` çağrısı `Microsoft Learn MCP Server` sürüm `1.0.0` döndürdü; `tools/list` ile salt-okunur `microsoft_docs_search`, `microsoft_docs_fetch` ve `microsoft_code_sample_search` araçları keşfedildi.

**official documentation:** Katalog araması O2C’yi katalog numarası 65, S2P’yi 75 olarak doğruladı. Güncel O2C overview ayrıca sayfa başlıklarının Temmuz 2026 katalog sürümüne geçirildiğini, bazı diyagramların daha eski olabileceğini bildiriyor. Kaynaklar: [Order to cash introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-introduction), [Order to cash overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-overview), [Source to pay introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-introduction).

## 3. Mevcut mimari envanteri

### 3.1 Çalışan yüzeyler

| Katman | Mevcut gerçeklik | Kanıt |
|---|---|---|
| Backend | Node.js üzerinde Hono; CORS, secure headers, compression, request ID, logging, Redis rate limit, health ve OpenAPI | **repo-verified:** `backend/src/app.ts:1-18`, `backend/src/app.ts:44-59`, `backend/src/app.ts:61-155` |
| API güvenlik zinciri | Tenant çözümleme → JWT doğrulama → write audit | **repo-verified:** `backend/src/app.ts:161-190` |
| ORM / DB | Prisma 5.9, PostgreSQL | **repo-verified:** `backend/prisma/schema.prisma:4-12`, `backend/package.json` |
| Web ERP | Next.js 14 App Router, React Query, Zustand, React Hook Form, Tailwind | **repo-verified:** `frontend/package.json`, `frontend/src/components/erp/Sidebar.tsx:14-137` |
| Web POS | Next.js uygulamasının `/pos` yüzeyi | **repo-verified:** `frontend/src/app/pos/main/page.tsx`, `frontend/src/app/pos/receipt/page.tsx` |
| Mobil POS | Ayrı nested Git deposu; Expo Router, React Native 0.81, Query/Zustand | **repo-verified:** `skarpine-pos/package.json`, `skarpine-pos/app/index.tsx:13-37` |

### 3.2 Dokümantasyon çelişkisi

**repo-verified:** `AGENTS.md` ürün stack’ini Express olarak tanımlıyor; çalışan backend Hono’dur (`backend/src/server.ts:1-14`, `backend/src/app.ts:1-14`). Bu küçük bir isim hatası değil; middleware, hata yönetimi, route composition ve test yaklaşımını etkileyen mimari doküman sapmasıdır.

**architectural recommendation:** Stack beyanları `AGENTS.md`, `HANDOVER.md`, README ve OpenAPI açıklamalarında tek seferde Hono olarak güncellenmelidir.

### 3.3 Modül envanteri

| İş alanı | Backend | Web ERP/POS | Mobil POS | Olgunluk |
|---|---:|---:|---:|---|
| Kimlik, kullanıcı, rol | Var | Var | Var | Temel roller; ayrıntılı görev ayrılığı sınırlı |
| Tenant | Var | Header tabanlı | Header tabanlı | Uygulama izolasyonu var; DB RLS yok |
| Ürün/PIM | Var | Var | Okuma | Boyut grubu, varyant, UOM, item group güçlü |
| Stok | Var | Var | Satış sırasında tüketim | Transaction/subledger var; rezervasyon derinliği sınırlı |
| Depo | Var | Var | Yok | Zone/location, directive/template/wave/work var; outbound load ve shipment line yok |
| CRM | Var | Var | Yok | Lead, opportunity ve stage mevcut |
| Quotation | Var | Var | Yok | Yaşam döngüsü ve order conversion mevcut |
| Satın alma talebi/RFQ | Var | Var | Yok | Requisition, vendor request/bid, award ve PO conversion mevcut |
| PO / receipt / vendor invoice | Var | Var | Yok | Fiziksel ve finansal belge ayrımı, matching mevcut |
| Sales order / shipment / factura | Var | Var | POS akışı | Sipariş ve factura güçlü; shipment header-only |
| Tahsilat / ödeme | Basit route | Basit UI | POS anında ödenmiş | Settlement modeli yok |
| GL / journal | Var | Var | Dolaylı | Merkezi writer ve correction var |
| Finansal boyut | Var | Kısmi setup/report | Yok | Dört sabit slot; manual journal picker yok |
| Vergi | Var | Kısmen eski hesap | Eski hesap önizlemesi | Backend iyi, istemci drift’i kritik |
| Fiyat anlaşması | API/service var | UI yok | Yok | Canlı backend kabiliyeti görünür değil |
| Raporlama | CEO, stok, finans | Var | Z-report | Yönetim görünümü iyi; settlement temelli aging değil |
| Audit | Write request audit | Listeleme UI | Yok | Entity diff ve garantili yazım değil |

Backend’in route yüzeyi **repo-verified** olarak `backend/src/app.ts:168-190` satırlarında listelenmektedir.

## 4. Süreç doğrulaması

### 4.1 Prospect to Quote ve O2C

| Aşama | Uygulama durumu | Kanıt | Hüküm |
|---|---|---|---|
| Lead | Open/qualified/disqualified akışları | **repo-verified:** `backend/prisma/schema.prisma:2930-2983`; `backend/src/modules/crm/crm.routes.ts:71-183` | Uygun çekirdek |
| Opportunity | Stage, probability, estimated close, close | **repo-verified:** `backend/prisma/schema.prisma:2997-3057`; `backend/src/modules/crm/crm.routes.ts:190-274` | Uygun çekirdek |
| Quotation | Draft/send/revise/confirm/lose/cancel ve order conversion | **repo-verified:** `backend/prisma/schema.prisma:3074-3134`; `backend/src/modules/sales/quotation.routes.ts:22-111` | Güçlü |
| Sales order | Kaynak belge provenance, warehouse/site, line quantities | **repo-verified:** `backend/prisma/schema.prisma:1401-1509` | Güçlü temel |
| Shipment | Yalnız header | **repo-verified:** `backend/prisma/schema.prisma:1512-1527`; `ShipmentLine` modeli bulunmadı | Kritik davranış/izlenebilirlik açığı |
| Factura | Header + immutable line snapshot | **repo-verified:** `backend/prisma/schema.prisma:1972-1995`, `backend/prisma/schema.prisma:3576-3619` | Güçlü, fakat credit note satırları eksik |
| Payment | Order’a bağlı tek `paid_at` | **repo-verified:** `backend/src/modules/sales/sales.routes.ts:365-416` | Modern AR settlement için yetersiz |
| Return | Stok, invoice, COGS ve gerekiyorsa payment reversal tek transaction | **repo-verified:** `backend/src/modules/sales/sales.routes.ts:591-720` | Muhasebe düşüncesi güçlü; kısmi iade yok |

**official documentation:** Microsoft, O2C’yi müşteri siparişinden ödemenin faturayla settle edilmesine kadar tanımlar; prospect marketing, lead/opportunity ve quote creation’ı Prospect to Quote’a, fulfilment’ı Inventory to Deliver’a ayırır. Bu nedenle repodaki süreç sınırı doğrudur. Kaynaklar: [Order to cash introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-introduction), [Order to cash overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-overview), [Prospect to quote introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/prospect-to-quote-introduction).

**Contradiction:** `Shipment` belgesi mevcut olduğu için O2C “shipping tamam” kabul edilemez. Satır, miktar, packing slip/proof-of-delivery ve load ilişkisi olmayan header, parsiyel sevkiyatı ve hangi satırın ne kadar teslim edildiğini kanıtlayamaz. `SalesOrderLine.delivered_qty` tek başına belge izi değildir.

### 4.2 Source to Pay

| Aşama | Uygulama durumu | Kanıt | Hüküm |
|---|---|---|---|
| Purchase requisition | Header/line, submit, approve/reject/cancel, PO/RFQ conversion | **repo-verified:** `backend/prisma/schema.prisma:3184-3275`; `backend/src/modules/purchase/procurement.routes.ts:50-179` | Güçlü SME kapsamı |
| RFQ | Case, vendor request, bid, comparison, multi-vendor award | **repo-verified:** `backend/prisma/schema.prisma:3280-3463`; `backend/src/modules/purchase/procurement.routes.ts:192-267` | D365-anatomisine yakın |
| Purchase order | Provenance, warehouse/site, line receipt/invoice quantities | **repo-verified:** `backend/prisma/schema.prisma:882-1012` | Güçlü temel |
| Product receipt | Ayrı fiziksel belge, packing slip zorunlu, partial receipt | **repo-verified:** `backend/src/modules/purchase/productReceipt.service.ts:18-51`, `backend/src/modules/purchase/productReceipt.service.ts:106-152` | Çok güçlü |
| Vendor invoice | Ayrı finansal belge, PO’suz invoice kancası, posting | **repo-verified:** `backend/src/modules/purchase/vendorInvoice.service.ts:21-49`, `backend/prisma/schema.prisma:1126-1291` | Çok güçlü |
| Matching | Two-/three-way policy, tolerances, receipt-line allocation | **repo-verified:** `backend/src/shared/services/invoiceMatching.service.ts:1-220`; `backend/prisma/schema.prisma:1273-1291` | Ürün segmenti için ileri düzey |
| AP payment | PO’ya bağlı tek `paid_at` | **repo-verified:** `backend/src/modules/purchase/purchase.routes.ts:395-432` | Vendor invoice settlement değildir |

**official documentation:** S2P’nin güncel business process alanları “Procure materials and services”, “Process vendor invoices” ve “Issue and settle vendor payments” adımlarını ayrı gösterir. Vendor invoice sayfası PO→product receipt→vendor invoice döngüsünü, PO satırına bağlı olmayan invoice line’ları ve tamamen PO’suz invoice’ları açıkça destekler. Three-way matching içeriği invoice line’ın posted receipt line’larına miktar tamamen eşleşene kadar bağlanmasını doğrular. Kaynaklar: [Source to pay overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-overview), [Vendor invoices overview](https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview), [Match product receipts to invoice lines](https://learn.microsoft.com/dynamics365/finance/accounts-payable/submit-invoice-workflow-automatically#matching-posted-product-receipts-to-invoice-lines-that-have-a-three-way-matching-policy).

**Contradiction:** UI ve bazı raporlar “ödenecek PO” dili kullanıyor; modern AP borcu PO’dan değil posted vendor invoice’dan doğar. Şemada vendor invoice mevcutken ödeme route’unun hâlâ `PurchaseOrder.paid_at` kapatması, yeni P2P modelinin finansal son adımında eski MVP davranışının kalmasıdır.

### 4.3 Inventory to Deliver / warehouse

**repo-verified güçlü yönler:**

- Zone, location, location format, work template, location directive, wave template, wave, warehouse work ve work line modelleri var (`backend/prisma/schema.prisma:106-180`, `backend/prisma/schema.prisma:665-878`).
- Depo içi hareket transfer-out/transfer-in transaction çifti olarak yazılıyor (`backend/src/modules/warehouse/warehouse.service.ts:449-460`, `backend/src/modules/warehouse/warehouse.service.ts:668-669`).
- Stok hareketleri receipt/issue durum merdivenine sahip (`backend/src/shared/services/inventoryTransactionStatus.ts:1-87`).
- Talep belgelerinde warehouse tutuluyor, site warehouse’tan türetiliyor (`backend/prisma/schema.prisma:2271-2286`).

**official documentation:** Release to warehouse süreci order release edildiğinde load lines ve shipments; konfigürasyona bağlı olarak wave ve work oluşturur. Shipment aynı customer/receiver veya delivery address’e giden order line grubudur; load bir ya da daha fazla shipment taşıyabilir. Bu resmî anatomi, satırsız `Shipment` modelinin tamamlanması gerektiğini destekler. Kaynak: [Release to warehouse](https://learn.microsoft.com/dynamics365/supply-chain/warehousing/release-to-warehouse-process).

**repo-verified açıklar:**

- `Load` ve `ShipmentLine` modeli yok.
- `WarehouseParameters.require_pick_work` okunuyor ve setup ekranında gösteriliyor; operasyonel sales release akışında bu parametreyi kullanan kod bulunmadı (`backend/prisma/schema.prisma:163`, `backend/src/shared/services/warehouseParameters.service.ts:45-54`, `frontend/src/app/(erp)/setup/warehouse/page.tsx:148`).
- Sales release’in gerçek kapısı item-model-group `pickingRequirements` sonucudur (`backend/src/modules/sales/sales.service.ts:159-197`). Warehouse parametresi ile aynı şey değildir.
- Shipment number `SHP-${Date.now()}` ile üretiliyor (`backend/src/modules/sales/sales.service.ts:282-295`); NumberSequence temeline bağlı değil.

**architectural recommendation:** Advanced WMS’e benzeyen her ekranı eklemek yerine mevcut directive/template/work omurgasını tamamlayacak minimum “ShipmentLine + release allocation + work completion provenance” dilimi uygulanmalıdır. Load planning, carrier tendering ve route optimization bu hedef müşteri için ertelenebilir.

## 5. Veri modeli ve D365-anatomisi uyumu

### 5.1 Doğru alınmış anatomiler

| Anatomi | Repo uygulaması | Değerlendirme |
|---|---|---|
| Product dimension / released variant | Dimension, value, group, line ve variant-value ilişkileri | **repo-verified:** `backend/prisma/schema.prisma:252-360`, `backend/prisma/schema.prisma:414-546`; gelecek varyant büyümesine uygun |
| Physical vs financial inventory update | Receipt/issue durumları, receipt belgesi, cost layer | **repo-verified:** `backend/prisma/schema.prisma:572-663`; iyi temel |
| Posting profile resolution | ITEM→ITEM_GROUP→PARTY→PARTY_GROUP→ALL, date-effective | **repo-verified:** `backend/src/shared/services/postingProfile.service.ts:14-23`, `backend/src/shared/services/postingProfile.service.ts:53-128` |
| Tax group ∩ item tax group | Tax code, party group, item group ve link tabloları | **repo-verified:** `backend/prisma/schema.prisma:2479-2642`; ülke if-branch’lerinden daha sağlam |
| Financial dimensions | Dört sabit indexed slot, entity-backed/default assignments, requirement rules | **repo-verified:** `backend/prisma/schema.prisma:1801-1969`; SME raporlama için dengeli |
| Operating unit | Type discriminator + parent hook | **repo-verified:** `backend/prisma/schema.prisma:1605-1636`; ağır generic hierarchy olmadan büyüme kancası |
| Number sequence | Scope, format, continuous/non-continuous ve atomic allocation | **repo-verified:** `backend/src/shared/services/numberSequence.service.ts:15-38`, `backend/src/shared/services/numberSequence.service.ts:94-157` |
| Trade agreement | Party/product scope, quantity break, date effectivity | **repo-verified:** `backend/prisma/schema.prisma:3492-3558`; backend var, ürün yüzeyi eksik |
| Corrections | Generated reversal, provenance, one-time correction constraint | **repo-verified:** `backend/prisma/schema.prisma:1768-1778`, `backend/src/shared/services/journal.service.ts:119-126` |

**official documentation:** Microsoft Learn şu temel eşleşmeleri doğrular:

- Sales tax group party’ye, item sales tax group resource’a bağlıdır; kesişimdeki tax code’lar uygulanır: [Sales tax overview](https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview).
- Financial dimensions transaction’ları analiz için sınıflandırır ve custom/entity-backed olmak üzere iki tipe ayrılır: [Financial dimensions](https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions).
- Trade agreement’ta Party code type Table/Group/All’dır; Price için product code Table gerekir ve From/To quantity break desteklenir: [Create a new trade agreement](https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/tasks/create-new-trade-agreement).
- Continuous sequence boşluk kabul etmez; her numara için DB etkileşimi ve locking maliyeti taşır: [Continuous number sequence performance](https://learn.microsoft.com/dynamics365/guidance/techtalks/finance-operations-continuous-number-sequence-performance-improvements).

### 5.2 Bilinçli ve doğru kapsam kesintileri

**architectural recommendation:** Aşağıdaki kesintiler korunmalıdır:

- Tam D365 account structure/advanced rule motoru yerine category-based dimension requirement.
- Tam EAV financial dimension kombinasyon motoru yerine dört sabit slot.
- Workflow designer yerine eşik + tek onay davranışı.
- D365’in geri dönüşü zor “WMS enabled warehouse” tek yönlü anahtarı yerine warehouse bazlı davranış parametreleri.
- Production/master planning yokluğu. Perakendeci hedef müşteride davranış kapsamına alınmamalı.
- Trade agreement journal validate/post seremonisi yerine doğrudan date-effective kayıt.

Bu kesintiler özellik yüzeyini azaltırken ileride veri migrasyonu gerektirecek temel kimlikleri, provenance alanlarını ve nullable ilişkileri koruyor.

### 5.3 Şema kancası denetimi

| Ertelenen kabiliyet | Bugünkü kanca | Karar |
|---|---|---|
| Çoklu legal entity | Konfigürasyon ve tax tablolarında nullable `legal_entity_id` | Kanca var; LegalEntity master henüz yok |
| Tax settlement period | `TaxCode.settlement_period_id` | Kanca var; FK/table henüz yok |
| Landed cost | `InventoryParameters.capitalise_landed_cost`; cost layer mimarisi | Kısmi kanca; allocation/provenance modeli ayrıca tasarlanmalı |
| Party groups | `party_group_id` ve PARTY_GROUP scope | Kanca var ama master/resolver bilinçli olarak çözmüyor |
| Fixed financial dimension | `DimensionRule.fixed_value_id` | Kanca var; resolver okumuyor |
| Partial invoicing | SalesOrderLine invoiced/delivered quantities ve FacturaLine | Kanca/temel var; tam UI/işlem davranışı tamamlanmalı |
| Credit note details | FacturaLine modeli yeniden kullanılabilir | Kanca var; return route satır yazmıyor |
| Shipment details | Yok | **Şema açığı:** ShipmentLine eklenmeden güvenilir partial delivery kurulamaz |
| Load planning | Yok | Hedef müşteri için ertelenebilir; Shipment’a nullable `load_id` şimdi eklemek zorunlu değil, çünkü Load kimliği henüz tanımlı değil |
| Payment allocation/settlement | Yok | **Şema açığı:** sonradan eklemek geçmiş `paid_at` verisini yorumlama/backfill gerektirecek |
| Production/master planning | Bilinçli olarak yok | Doğru; yapay kanca eklenmemeli |

## 6. Muhasebe ve alt defter değerlendirmesi

### 6.1 Güçlü yönler

- **repo-verified:** `postJournal()` bütün otomatik writer’lar için kaynak/provenance, period check, balance, rounding ve dimension resolution merkezidir (`backend/src/shared/services/journal.service.ts:92-204`).
- **repo-verified:** Kapalı dönem kontrolü yalnız manual journal’da değil, merkezi writer’da uygulanır (`backend/src/shared/services/journal.service.ts:164-203`).
- **repo-verified:** Posting profile çözülemezse belgenin sessizce journalsız kalması yerine exception üretilir (`backend/src/shared/services/postingProfile.service.ts:14-23`, `backend/src/shared/services/postingProfile.service.ts:123-128`).
- **repo-verified:** Receipt ile vendor invoice ayrı accounting event’tir; receipt accrual ve invoice/AP ayrımı kodda gerçek servislerdir (`backend/src/modules/purchase/productReceipt.service.ts:18-51`, `backend/src/modules/purchase/vendorInvoice.service.ts:21-49`).
- **repo-verified:** Financial dimension defaulting sırası explicit → document → master data → null olarak merkezidir (`backend/src/shared/services/dimension.service.ts:240-300`).

### 6.2 Kritik açık: settlement alt defteri

**repo-verified:** Satış tahsilatı order total’ını tek seferde banka/kasa karşılığı AR’a yazar ve `SalesOrder.paid_at` set eder (`backend/src/modules/sales/sales.routes.ts:365-416`). Satın alma ödemesi de PO üzerinde aynı modeli kullanır (`backend/src/modules/purchase/purchase.routes.ts:395-432`). Şemada `Payment`, `CustomerPayment`, `VendorPayment` veya `Settlement` modeli bulunmadı.

Bu nedenle sistem şu modern ERP davranışlarını temsil edemez:

- kısmi ödeme ve kalan açık bakiye;
- bir ödemenin birden fazla faturaya dağıtılması;
- bir faturaya birden fazla ödeme;
- avans/on-account payment;
- write-off, iskonto ve kur farkı;
- gerçek invoice-based aging;
- ters ödeme ve yeniden mahsup;
- vendor invoice ile payment’ın bağımsız provenance’ı.

**official documentation:** Bu eksik yalnız “D365’e benzememe” yorumu değildir. O2C tanımı süreci payment’ın invoice ile settle edilmesine kadar götürür; S2P catalog ise vendor invoice processing ile vendor payment issuance/settlement’ı ayrı business process alanları olarak tanımlar. Kaynaklar: [Order to cash introduction](https://learn.microsoft.com/dynamics365/guidance/business-processes/order-to-cash-introduction), [Source to pay overview](https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-overview).

**architectural recommendation:** `PaymentHeader`, `PaymentLine` ve `Settlement` omurgası kurulmalı; settlement `posted invoice ↔ payment line ↔ amount/currency/date` ilişkisidir. `paid_at` türetilmiş/legacy alan olmalı, accounting truth olmamalıdır.

## 7. Vergi ve Bolivya değerlendirmesi

### 7.1 Backend motoru

**repo-verified:** TaxCode modeli `tax_type`, `applies_to`, `rate`, `is_inclusive`, `base_kind`, `is_recoverable`, reverse charge, withholding, exemption ve date effectivity taşır (`backend/prisma/schema.prisma:2479-2594`). Bu, Bolivya IVA ve sales-only IT’yi aynı “VAT” alanına sıkıştırmaz.

**official documentation:** Microsoft’un temel vergi modeli party üzerindeki sales tax group ile resource üzerindeki item sales tax group kesişimine dayanır; Quberty’nin grup kesişimi bu anatomiyle uyumludur. Kaynak: [Sales tax overview](https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview).

**repo-verified:** Hesap motoru GROSS ve NET inclusive tax’leri ayırır, turnover base’ini config’den alır (`backend/src/shared/services/tax.service.ts:199-208`, `backend/src/shared/services/tax.service.ts:254-268`).

**repo-verified:** Mevcut test örneği Bs 1.299 satış için IVA 168,87 ve IT 38,97 bekler; eski yolun 149,44/34,49 ürettiğini özellikle defect olarak kaydeder (`backend/src/__tests__/tax.service.test.ts:86-109`).

**repo-verified:** Doküman tax service’i hâlâ total-level hesap yapıyor ve çok oranlı pazarlar için bunun geçersiz olduğunu kendi içinde açıkça belirtiyor; line-level hook mevcut (`backend/src/shared/services/documentTax.service.ts:33-43`).

### 7.2 Kritik istemci drift’i

**repo-verified:** Aşağıdaki istemci/PDF kodları eski `total / 1.13` ve `subtotal * 0.03` formülünü taşır:

- `frontend/src/stores/posCartStore.ts:73-75`
- `skarpine-pos/src/store/cartStore.ts:82-90`
- `frontend/src/components/erp/sales/SalesOrderPDF.tsx:107-109`
- `frontend/src/app/(erp)/sales/orders/page.tsx:35-37`
- `frontend/src/app/(erp)/sales/orders/[id]/page.tsx:106-108`
- `frontend/src/app/(erp)/finance/facturas/page.tsx:42-44`

Bu formül backend testinin yanlış diye belgelediği aritmetiktir. Sonuç yalnız kozmetik değildir: müşteriye gösterilen PDF, kasiyerin gördüğü kırılım, factura ekranı ve GL posting aynı ekonomik olayı farklı açıklayabilir.

**Fix — P0:** İstemciler vergi hesaplamamalı. Backend her draft/quote/order/factura response’unda canonical `tax_lines`, `tax_base`, `vat_amount`, `turnover_amount`, `total_amount` döndürmeli; UI yalnız bunları göstermelidir. Offline POS gerekiyorsa versioned tax policy snapshot indirilmeli ve server reconciliation yapılmalıdır.

### 7.3 Factura numaralandırma

**repo-verified:** Genel number sequence servisi continuous serileri caller transaction içinde zorunlu kılar (`backend/src/shared/services/numberSequence.service.ts:101-157`). Ancak satış ve POS factura akışları bu servisi kullanmaz:

- Sales kendi `FacturaCounter` SQL’ini kullanır ve numarayı ana transaction’dan önce ayırır (`backend/src/modules/sales/sales.routes.ts:25-40`).
- POS ayrı bir helper kullanır ve ilk counter kaydını her zaman 1’den başlatır (`backend/src/modules/pos/pos.routes.ts:21-30`); numarayı ana transaction’dan önce ayırır (`backend/src/modules/pos/pos.routes.ts:143-154`).

İki helper aynı counter tablosunu kullansa da başlangıç davranışları farklıdır. Factura satırı yazımı veya posting başarısız olduğunda önceden ayrılan numara boşluk bırakabilir.

**official documentation:** D365 continuous sequence’lerin boşluk kabul etmediğini ve DB etkileşimi/locking maliyeti yarattığını açıkça belirtir. Bu, Quberty’de hukukî olarak gapless seçilen bir serinin ana transaction dışında ayrılamayacağı yönündeki mimari hükmü destekler. Kaynak: [Continuous number sequence performance](https://learn.microsoft.com/dynamics365/guidance/techtalks/finance-operations-continuous-number-sequence-performance-improvements).

**assumption needing validation:** Bolivya’da bu belge türü ve mevcut elektronik fatura rejimi için kesintisiz sıra zorunluluğunun tam kuralı, iptal/void numaralarının muamelesi ve şube/point-of-sale bazlı seri sınırı SIN normativa üzerinden doğrulanmalıdır.

**architectural recommendation:** Hukukî karar ne çıkarsa çıksın tek allocator kullanılmalı. Gapless zorunluysa FACTURA continuous sequence transaction içinde ayrılmalı; değilse boşlukların sebebi audit edilebilir olmalıdır. POS ve back-office ayrı seri gerektiriyorsa sequence scope’a terminal/branch/point-of-sale boyutu eklenmelidir.

### 7.4 Açık Bolivya kararları

| Konu | Durum |
|---|---|
| Factura continuous/gapless ve scope | **assumption needing validation** |
| Factura line detail hukukî zorunluluğu | **assumption needing validation**; schema satırları var |
| Credit/debit note ayrı seri ve yasal ilişki | **assumption needing validation** |
| Input IVA recognition zamanı | **assumption needing validation**; config alanı var, receipt service fiilen invoice yaklaşımına evrilmiş |
| Ley 1733 yürürlük/decree tarihi | **assumption needing validation**; date-effective TaxCode hazır |
| Imports/landed cost | **assumption needing validation**; davranış yok |

## 8. Multi-tenancy, güvenlik ve audit

### 8.1 Tenant izolasyonu

**repo-verified:** Tenant middleware `X-Tenant-ID` ister ve aktif tenant’ı çözer (`backend/src/shared/middleware/tenantMiddleware.ts:5-29`). Auth middleware JWT içindeki tenant ile header tenant’ını eşleştirir (`backend/src/shared/middleware/authMiddleware.ts:6-45`). Bu doğru uygulama katmanı korumasıdır.

**repo-verified:** Repoda `ENABLE ROW LEVEL SECURITY`, `CREATE POLICY` veya session tenant policy kullanımı bulunmadı. Dolayısıyla ham DB erişimi veya tenant filtresini unutan yeni query için ikinci savunma katmanı yoktur.

**repo-verified:** Aşağıdaki tenant-scoped belgeler global `@unique` kalmıştır:

- `PurchaseOrder.po_number` — `backend/prisma/schema.prisma:885`
- `SalesOrder.order_number` — `backend/prisma/schema.prisma:1404`
- `Shipment.shipment_number` — `backend/prisma/schema.prisma:1515`
- `JournalEntry.entry_number` — `backend/prisma/schema.prisma:1758`

Factura doğru biçimde `@@unique([tenant_id, factura_number])` kullanır (`backend/prisma/schema.prisma:1993`).

**Fix — P0:** Eski global unique’ler tenant-aware composite unique’e taşınmalı. Bu yalnız collision sorunu değil; ürünün açık multi-tenant invariant’ının ihlalidir.

**Update — P1:** PostgreSQL RLS veya eşdeğer DB-level tenant guard tasarlanmalıdır. İlk adımda tüm tablolarda FK/RLS geçirmek zor olabilir; en az finansal ve legal belge tabloları için defense-in-depth uygulanmalıdır.

### 8.2 Yetkilendirme

**repo-verified:** `requireRole()` route düzeyinde basit rol kontrolüdür (`backend/src/shared/middleware/authMiddleware.ts:48-60`). Admin/store_manager ayrımları birçok mutation’da uygulanır.

**gap:** Approval submitter/approver ayrılığı, posting yetkisi, payment entry vs approval, period close ve audit read gibi görev ayrılığı (SoD) bir permission matrisi değildir. ≤50 çalışan hedefinde tam enterprise security role designer gereksizdir; fakat finansal dört-eyes kontrolleri için küçük bir capability seti gereklidir.

### 8.3 Audit

**repo-verified:** Write middleware method/path/status/sanitized request body/IP/user agent kaydeder (`backend/src/shared/middleware/auditLog.ts:21-52`). Yazım fire-and-forget’tir ve başarısızlığı ana işlemi durdurmaz.

Bu audit HTTP eylem günlüğüdür; muhasebe/legal entity change log değildir. Before/after state, entity key, reason code ve transaction ile atomic persistence yoktur.

**architectural recommendation:** Genel UI audit’i fire-and-forget kalabilir. Fakat posted invoice, payment, journal, tax configuration, number sequence ve period close için domain event/audit satırı ana DB transaction’ın parçası olmalıdır.

## 9. UI/UX ve ürün paketlenebilirliği

### Güçlü taraflar

- **repo-verified:** Sidebar ürün, inventory, warehouse, sales, purchase, CRM, HR, finance, reporting, audit ve setup yüzeylerini tutarlı iş alanları altında gösterir (`frontend/src/components/erp/Sidebar.tsx:14-137`).
- **repo-verified:** Setup audit/provisioning yaklaşımı, eksik posting profiles ve kritik konfigürasyonu satış anından önce görünür kılmayı hedefler (`backend/src/shared/services/postingProfile.service.ts:161-182`).
- **repo-verified:** POS satışı stok→SO→factura→GL→session toplamını tek transaction’da işler (`backend/src/modules/pos/pos.routes.ts:122-154`, `backend/src/modules/pos/pos.routes.ts:154-383`).

### Açıklar

- Trade Agreement backend/API var, UI yok (`backend/src/modules/purchase/purchase.routes.ts:625-697`).
- Sales/Purchase parameters schema zengin, fakat tam yönetim ekranları yok.
- Manual journal UI financial dimension picker sunmuyor.
- Warehouse `require_pick_work` ekranda disabled ve operasyonel olarak inert.
- Mobil POS API adresi LAN IP’sine gömülü (`skarpine-pos/src/api/client.ts:4-10`).
- Mobilde camera/barcode paketleri var, fakat gerçek CameraView kullanımına rastlanmadı; scanner kabiliyeti varmış gibi pazarlanmamalı.
- Backend tax response’ları yerine istemci yeniden hesaplıyor.

**architectural recommendation:** Yeni modül eklemekten önce “setup-to-operation completeness” standardı konmalıdır: bir kabiliyet ancak schema + service + API + permission + setup UI + operational UI + audit + test zinciri tamamlandığında ürün özelliği sayılmalıdır.

## 10. Teslimat ve teknik borç

### 10.1 Migration disiplini

**repo-verified:** `backend/prisma/migrations` yok; `backend/prisma/sql` altında `001`–`022` el SQL’i var. Prisma schema yorumları, partial index’lerin Prisma tarafından ifade edilemediğini ve `prisma db push` tarafından düşürülebileceğini açıkça söyler (`backend/prisma/schema.prisma:1938-1945`).

**Fix — P0:** Ürünleşmeden önce baseline migration oluşturulmalı, SQL 001–022 kontrollü bir migration geçmişine çevrilmeli, checksum/applied ledger eklenmeli ve CI’da boş DB’den kurulum ile drift kontrolü yapılmalıdır.

### 10.2 Çalışma ağacı ve nested repo

**repo-verified (git status, 2026-09-04):** Parent repo `skarpine-pos` için modified gitlink/worktree gösteriyor; nested POS repo’da temel config dosyaları modified ve `app/`, `src/` dahil ana uygulama dosyaları untracked. Bu rapor bunlara dokunmamıştır.

**risk:** Mobil POS’un fiilî uygulamasının önemli bölümü commit dışındaysa build’in başka makinede yeniden üretilebilir olduğu söylenemez.

> **SUPERSEDED 2026-09-07 — the 2026-09-04 observation above is preserved as history and is no
> longer current.** The nested POS repository was committed to
> `codex/wip-incomplete-pos-2026-09-06` (`09fa4de`) and pushed to the private remote
> `Quberty-POS`; its tree is clean and it is recoverable off-machine. The parent's unregistered
> gitlink was removed in the V1 reconstruction commit, so the parent no longer tracks the POS at
> all. The stated risk is therefore closed **as a Git-recoverability risk**. It is *not* closed as
> a product risk: the POS application remains functionally incomplete and its type-check reports
> five known TypeScript errors.

### 10.3 Test görünürlüğü

**repo-verified:** Backend içinde 10 test dosyası bulundu; frontend ve mobile altında test dosyası bulunmadı. Bu çalışmada kullanıcı talimatı gereği test/build çalıştırılmadı.

**unverified:** Handover’ın “119 passing / 4 pre-existing failing suites” beyanı bu çalışmada yeniden koşturulmadı; güncel kalite kanıtı olarak sunulmamalıdır.

## 11. Önceliklendirilmiş yol haritası

### Faz 0 — Muhasebesel tek doğruluk kaynağı ve release gate

Amaç: Bir satışın ekranda, PDF’de, factura’da, subledger’da ve GL’de aynı rakam ve kimlikle görünmesini garanti etmek.

1. Client-side IVA/IT hesaplarını kaldır; backend canonical money/tax contract’ı kullan.
2. Factura numbering’i tek allocator’a bağla ve hukukî scope/gap kararını uygula.
3. Global document unique’lerini tenant-aware yap.
4. Formal migration baseline + CI drift/empty-database testini kur.
5. Mobil POS API URL’sini environment/config discovery’ye taşı; nested repo içeriğini commit edilebilir hale getir.

**Çıkış ölçütü:** Aynı fixture için web POS, mobile POS, back-office invoice, factura PDF ve GL tax satırları birebir eşleşir; rollback sonrası numbering davranışı karara uygundur; iki tenant aynı belge numarasını kullanabilir.

### Faz 1 — AR/AP settlement omurgası

1. Payment header/line ve settlement tablolarını tasarla.
2. Tahsilatı SalesOrder yerine posted Factura/AR open transaction’a bağla.
3. Ödemeyi PurchaseOrder yerine posted VendorInvoice/AP open transaction’a bağla.
4. Partial, multi-document, on-account, reversal ve write-off davranışlarını ekle.
5. Aging/reporting’i `paid_at` filtresinden open amount hesabına geçir.

**Çıkış ölçütü:** Kısmi tahsilat ve kısmi vendor payment, açık bakiye ve aging raporunda doğru görünür; settlement reversal tam provenance taşır.

### Faz 2 — Fulfilment bütünlüğü

1. ShipmentLine ve delivery quantity provenance ekle.
2. Warehouse release → wave/work → pick/pack → shipment/packing slip zincirini tek state machine ile bağla.
3. `require_pick_work` parametresini ya gerçekten uygula ya kaldır/yeniden adlandır.
4. Credit note’a FacturaLine yaz ve partial return tasarla.

**Çıkış ölçütü:** Bir order line’ın ordered/reserved/picked/packed/shipped/invoiced/returned miktarları belge zinciriyle reconcile olur.

### Faz 3 — Kurulum ve kontrol yüzeyi

1. Sales/Purchase/Inventory/Warehouse parameter ekranlarını tamamla.
2. Trade Agreement UI ve price source explanation ekle.
3. Manual journal dimension picker ve required/fixed rule görünürlüğü ekle.
4. Finance-sensitive domain audit’i transaction içine al.
5. Küçük capability-based permission matrisi kur.

### Faz 4 — Uluslararasılaştırma, yalnız talep olduğunda

1. Line-level tax engine refactor.
2. Currency/exchange rate, realized/unrealized FX ve document currency.
3. Tax settlement periods ve jurisdiction reporting.
4. Import/landed cost allocation.

Bu faz, Bolivya regresyon testleri geçmeden açılmamalıdır.

## 12. Günümüz ERP’lerine en çok yaklaştıracak tek stratejik tercih

**architectural recommendation:** Tek tercih yapılacaksa, “her operasyonel belgenin para gerçeğini canonical posted transaction + settlement omurgasına bağlamak” seçilmelidir.

Bu tercih yeni bir dashboard veya modül değildir. Şu sözleşmeyi ürünün merkezine koyar:

`document line → tax line → posted subledger transaction → settlement → GL voucher`

Neden en yüksek kaldıraçtır:

- Bugünkü tax/UI/GL drift’ini kökten kapatır.
- `paid_at` yerine gerçek AR/AP açık bakiye üretir.
- Kısmi ödeme, yaşlandırma, credit note ve reconciliation’ı aynı omurgaya bağlar.
- Audit ve correction’ın “hangi ekonomik olayı düzelttiği” kanıtlanır.
- Multi-currency ve e-invoice daha sonra yeni paralel gerçeklikler kurmadan eklenebilir.
- P2P/O2C’nin iki ayrı özellik koleksiyonu değil, aynı financial control plane’e yazan süreçler olmasını sağlar.

En doğru ilk dilim: canonical tax response + posted invoice open transaction + payment/settlement. Bu tamamlanmadan yeni ileri WMS/CRM yüzeyleri ürünün ERP niteliğini aynı ölçüde artırmaz.

## 13. Fix / Update / Reject / Defer karar listesi

### Fix

- İstemci/PDF vergi formülü drift’i.
- Factura allocator parçalanması ve transaction dışı numara ayırma.
- Global PO/SO/Shipment/Journal unique constraint’leri.
- Settlement’sız `paid_at` accounting truth’u.
- Formal migration zinciri yokluğu.
- Shipment’ın satırsız olması.
- Mobil POS hardcoded LAN API adresi ve commit dışı uygulama kaynakları.

### Update

- Express yazan mimari dokümanları Hono olarak düzelt.
- Handover’ın erken snapshot’ları ile son düzeltmeleri “superseded” işaretleriyle ayrıştır.
- Setup UI’yi canlı backend capability’leriyle hizala.
- Audit’i finansal domain event’leri için atomic hale getir.
- Test stratejisine frontend/mobile contract ve parity testleri ekle.

### Reject

- Tam D365 feature parity hedefi.
- Generic EAV financial dimension mimarisi.
- Schema-per-tenant yaklaşımı.
- ≤50 çalışan için genel amaçlı workflow designer.
- Üretim/master planning’i perakendeci anchor müşteri uğruna bugünden tasarlamak.
- Sırf D365’te var diye load planning, transportation management ve warehouse mobile menu framework’ünü topluca almak.
- Tax, GL account veya pricing’i yeniden service `if` ifadelerine gömmek.

### Defer

- Load/carrier/route optimization; önce ShipmentLine.
- Tax settlement period davranışı; FK hook var.
- Landed cost; talep ve Bolivya import süreci doğrulandıktan sonra.
- Party group master; PARTY_GROUP scope kullanıma açılmadan önce.
- Fixed dimension override; resolver ve UI birlikte yapılmalı.
- Çoklu legal entity master; nullable scope hook’ları var, fakat NIT/factura authorization sahipliği tasarlanmalı.
- Tam çoklu para; settlement omurgasından sonra.

## 14. Açık sorular

### İşletme sahibine / Kubi’ye

1. Back-office satışlarda kısmi tahsilat ve bir tahsilatı birden fazla factura’ya dağıtma bugün gerçek ihtiyaç mı, yoksa ilk paket sürümde yalnız tam ödeme mi desteklenecek?
2. Vendor ödemesi PO’ya mı, supplier factura’ya mı operasyonel olarak bağlanıyor? Mevcut kod PO diyor; P2P modeli invoice diyor.
3. Üç mağaza arasında merkez depo→mağaza replenishment için pick/work zorunlu mu, yoksa yalnız merkez depoda mı?
4. Trade agreement ilk müşteri için kullanılacak mı, yoksa UI yüzeyi paket ürünün B2B sürümüne mi ertelenecek?

### Finans danışmanına

1. Bolivya current regime’de IVA base ve IT base örnekleri, gerçek filed return/factura örnekleriyle teyit edilebilir mi?
2. Input IVA recognition receipt tarihinde mi yoksa supplier factura posting tarihinde mi olmalı?
3. Credit/debit note seri, referans ve iptal davranışı nedir?
4. `REVERSE` mi `STORNO` mu Bolivya defter/raporlama beklentisini karşılıyor?

### Hukuk / yerel vergi uzmanına

1. Factura numarası gerçekten gapless mı; iptal edilmiş numara hangi kayıtla korunur?
2. Seri tenant, legal entity, sucursal, punto de venta veya modality bazında mı tutulur?
3. Factura line detail ve ürün tanımlama için zorunlu alanlar hangileri?
4. Ley 1733’ün ilgili IVA değişikliklerini yürürlüğe sokan reglamentary decree yayımlandı mı ve efektif tarih nedir?

### Teknik ekibe

1. Production ortamı nerede? Repo yalnız test Supabase’i belgeliyor.
2. SQL 001–022 hangi ortamlara, hangi sırayla ve hangi checksum ile uygulandı?
3. POS nested repo’daki untracked dosyalar resmî uygulama kaynağı mı?
4. Offline POS hedef mi? Hedefse server vergi ve number allocation olmadan hangi işlemler kabul edilecek?
5. RLS kullanmama kararı bilinçli mi, yoksa henüz uygulanmadı mı?

## 15. Microsoft Learn MCP ile doğrulanan kaynaklar

Aşağıdaki ana kaynaklar `microsoft_docs_search` ile bulundu ve yüksek değerli sayfalar `microsoft_docs_fetch` ile tam içerik olarak açıldı. Rapor hükümleri bu kaynakların ilgili kapsamıyla sınırlıdır; Microsoft’un ürün davranışını Quberty’de aynen uygulama zorunluluğu olduğu sonucu çıkarılmamıştır.

- Source to Pay introduction: https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-introduction
- Source to Pay areas: https://learn.microsoft.com/dynamics365/guidance/business-processes/source-to-pay-areas
- Prospect to Quote introduction: https://learn.microsoft.com/dynamics365/guidance/business-processes/prospect-to-quote-introduction
- Inventory to Deliver overview: https://learn.microsoft.com/dynamics365/guidance/business-processes/inventory-to-deliver-overview
- Purchase requisitions: https://learn.microsoft.com/dynamics365/supply-chain/procurement/purchase-requisitions-overview
- Request for quotations: https://learn.microsoft.com/dynamics365/supply-chain/procurement/request-quotations
- Vendor invoices: https://learn.microsoft.com/dynamics365/finance/accounts-payable/vendor-invoices-overview
- Invoice matching: https://learn.microsoft.com/dynamics365/finance/accounts-payable/accounts-payable-invoice-matching
- Purchase order posting: https://learn.microsoft.com/dynamics365/finance/general-ledger/purchase-order-posting
- Product dimensions: https://learn.microsoft.com/dynamics365/supply-chain/pim/product-dimensions
- Financial dimensions: https://learn.microsoft.com/dynamics365/finance/general-ledger/financial-dimensions
- Default dimensions: https://learn.microsoft.com/dynamics365/finance/general-ledger/dimensions-default-values
- Inventory posting profiles: https://learn.microsoft.com/dynamics365/finance/general-ledger/inventory-posting-profiles
- Number sequences: https://learn.microsoft.com/dynamics365/fin-ops-core/fin-ops/organization-administration/number-sequence-overview
- Continuous sequences: https://learn.microsoft.com/dynamics365/guidance/techtalks/finance-operations-continuous-number-sequence-performance-improvements
- Indirect taxes: https://learn.microsoft.com/dynamics365/finance/general-ledger/indirect-taxes-overview
- Warehouse release: https://learn.microsoft.com/dynamics365/supply-chain/warehousing/release-to-warehouse-process
- Outbound load handling: https://learn.microsoft.com/dynamics365/supply-chain/warehousing/outbound-load-handling
- Sales returns: https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/sales-returns
- Trade agreements: https://learn.microsoft.com/dynamics365/supply-chain/sales-marketing/tasks/create-new-trade-agreement

### Resmî kaynakların doğrulamadığı konular

Aşağıdakiler bu D365 kaynaklarıyla doğrulanmış sayılmamalıdır:

- Bolivya SIN factura sıra, iptal, credit/debit note ve zorunlu satır detayı kuralları.
- Ley 1733’ün yürürlük ve reglamentary decree tarihi.
- Kubi’nin gerçek production ortamının yeri.
- Anchor müşterinin operasyonel onay, ödeme ve depo kullanım tercihleri.

Bu konular raporda `assumption needing validation` olarak bırakılmıştır.

## 16. Sonuç

Quberty’nin yönü doğrudur: süreç öncesi belgeler, fiziksel/finansal ayrım, posting profiles, tax code modeli, inventory dimensions ve financial dimensions bir SME ürünü için alışılmadık derecede sağlam bir temel oluşturuyor. En büyük risk “yeterince D365 değil” olması değil; aynı kavramın eski MVP yolu ile yeni ERP yolu arasında iki ayrı gerçeğe bölünmesidir.

Bu nedenle sıradaki değer, daha fazla modül eklemekten değil şu dört gerçeği tekleştirmekten gelir: tax calculation, legal numbering, invoice open amount ve settlement. Bunlar kapandığında mevcut modül yüzeyi paket ERP olarak anlamlı biçimde güvenilir hale gelir.

> **Doğrulama notu:** Microsoft Learn MCP bağlantısı, tool discovery, search ve fetch çağrıları başarılıdır. Dosya içerik ve link kontrolü ile `git diff --check` rapor tesliminden önce çalıştırılacaktır. Kullanıcı talimatı gereği test/build/migration çalıştırılmamıştır.
