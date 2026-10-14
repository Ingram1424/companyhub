/**
 * ระบบศูนย์รวมลิงก์และเว็บไซต์บริษัทในเครือ (Multi-Company Link Hub & Enterprise Portal)
 * ข้อมูลจำลองสำหรับสาธิตระบบ (Interactive Demo Data)
 */

const DEMO_COMPANIES = [
    {
        id: "comp_tech",
        code: "comp_tech",
        name_th: "บริษัท สยามเทคโนโลยี โซลูชั่น จำกัด",
        name_en: "Siam Technology Solutions Co., Ltd.",
        category: "เทคโนโลยี & ซอฟต์แวร์",
        website_url: "https://www.wikipedia.org",
        description: "ผู้ให้บริการคลาวด์ ซอฟต์แวร์ และโซลูชั่นดิจิทัลสำหรับองค์กร",
        tax_id: "0105558012341",
        branch_code: "00000",
        address: "888 อาคารไซเบอร์เวิลด์ ทาวเวอร์ เอ ชั้น 24 ถนนรัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310",
        phone: "02-123-4567",
        email: "contact@siamtech.co.th",
        invite_code: "INV-TECH-2026",
        logo_emoji: "💻",
        logo_image: null,
        color_accent: "#2563eb",
        status: "online",
        sub_links: [
            { id: "sub_1", title: "ระบบบัญชีและภาษี (Accounting)", url: "https://www.wikipedia.org", badge: "บัญชี" },
            { id: "sub_2", title: "ระบบบริหารจัดการโครงการ (Project Hub)", url: "https://github.com", badge: "โครงการ" },
            { id: "sub_3", title: "ระบบตั๋วแจ้งซ่อมบำรุงไอที (IT Helpdesk)", url: "https://stackoverflow.com", badge: "บริการ" }
        ],
        created_at: "2025-01-01T00:00:00Z"
    },
    {
        id: "comp_logistics",
        code: "comp_logistics",
        name_th: "บริษัท สยาม โลจิสติกส์ เอ็กซ์เพรส จำกัด",
        name_en: "Siam Logistics Express Co., Ltd.",
        category: "ขนส่ง & คลังสินค้า",
        website_url: "https://www.openstreetmap.org",
        description: "ศูนย์จัดการการขนส่งสินค้าด่วนทั่วประเทศและบริการบริหารคลังสินค้า",
        tax_id: "0105560098762",
        branch_code: "00000",
        address: "45/9 นิคมอุตสาหกรรมบางพลี ถนนเทพารักษ์ ตำบลบางเสาธง อำเภอบางเสาธง สมุทรปราการ 10570",
        phone: "02-987-6543",
        email: "ops@siamlogistics.co.th",
        invite_code: "INV-LOGIS-2026",
        logo_emoji: "🚚",
        logo_image: null,
        color_accent: "#059669",
        status: "online",
        sub_links: [
            { id: "sub_4", title: "ระบบติดตามพัสดุและยานพาหนะ (GPS Tracking)", url: "https://www.openstreetmap.org", badge: "ติดตาม" },
            { id: "sub_5", title: "ระบบจัดการคลังสินค้า (WMS Hub)", url: "https://archive.org", badge: "คลังสินค้า" }
        ],
        created_at: "2025-01-01T00:00:00Z"
    },
    {
        id: "comp_retail",
        code: "comp_retail",
        name_th: "บริษัท สยาม รีเทล คอมเมิร์ซ จำกัด",
        name_en: "Siam Retail Commerce Co., Ltd.",
        category: "ค้าปลีก & อีคอมเมิร์ซ",
        website_url: "https://www.w3schools.com",
        description: "ศูนย์กระจายสินค้าค้าปลีก แฟรนไชส์ และแพลตฟอร์มอีคอมเมิร์ซครบวงจร",
        tax_id: "0105563054329",
        branch_code: "00001",
        address: "99/1 ศูนย์การค้าเซ็นทรัลเวิลด์ ห้อง 405 ถนนพระราม 1 แขวงปทุมวัน เขตปทุมวัน กรุงเทพฯ 10330",
        phone: "02-555-8899",
        email: "finance@siamretail.co.th",
        invite_code: "INV-RETAIL-2026",
        logo_emoji: "🛍️",
        logo_image: null,
        color_accent: "#d97706",
        status: "online",
        sub_links: [
            { id: "sub_6", title: "ระบบขายหน้าร้านและสต็อกสินค้า (POS & Inventory)", url: "https://developer.mozilla.org", badge: "POS" },
            { id: "sub_7", title: "ร้านค้าออนไลน์ (E-Commerce Storefront)", url: "https://www.eff.org", badge: "ร้านค้า" }
        ],
        created_at: "2025-01-01T00:00:00Z"
    }
];

const INITIAL_MOCK_DATA = {
    // ข้อมูลบริษัทในเครือ (เริ่มต้นว่างเปล่า 100%)
    companies: [],

    // หมวดหมู่บัญชีมาตรฐาน (Standard Chart of Accounts)
    categories: [
        { id: "cat_inc_service", type: "income", code: "41000", name: "รายได้จากการให้บริการ / ลิขสิทธิ์" },
        { id: "cat_inc_sales", type: "income", code: "42000", name: "รายได้จากการขายสินค้า" },
        { id: "cat_inc_freight", type: "income", code: "43000", name: "รายได้ค่าขนส่งและบริการคลัง" },
        { id: "cat_inc_other", type: "income", code: "49000", name: "รายได้อื่น ๆ และดอกเบี้ยรับ" },
        { id: "cat_exp_cogs", type: "expense", code: "51000", name: "ต้นทุนขายและบริการ (COGS)" },
        { id: "cat_exp_salary", type: "expense", code: "52000", name: "เงินเดือนและสวัสดิการพนักงาน" },
        { id: "cat_exp_rent", type: "expense", code: "53000", name: "ค่าเช่าสำนักงานและคลังสินค้า" },
        { id: "cat_exp_utility", type: "expense", code: "54000", name: "ค่าน้ำ-ไฟ-อินเทอร์เน็ต-คลาวด์" },
        { id: "cat_exp_marketing", type: "expense", code: "55000", name: "ค่าการตลาดและโฆษณาออนไลน์" },
        { id: "cat_exp_professional", type: "expense", code: "56000", name: "ค่าบริการวิชาชีพ (ที่ปรึกษา/ทนาย/ไอที)" },
        { id: "cat_exp_transport", type: "expense", code: "57000", name: "ค่าน้ำมันและบำรุงรักษายานพาหนะ" },
        { id: "cat_exp_misc", type: "expense", code: "59000", name: "ค่าใช้จ่ายเบ็ดเตล็ดและเครื่องเขียน" }
    ],

    // ผู้ใช้งานเริ่มต้นสำหรับผู้ดูแลระบบ
    users: [
        {
            id: "admin",
            username: "admin",
            full_name: "ผู้ดูแลระบบ (Administrator)",
            email: "admin",
            password: "admin123",
            role: "super_admin",
            company_id: null,
            title: "ผู้ดูแลระบบศูนย์รวมลิงก์ (System Administrator)",
            avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80"
        }
    ],

    transactions: [],
    historicalData: []
};
