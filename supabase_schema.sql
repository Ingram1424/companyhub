-- ==============================================================================
-- สคริปต์สร้างฐานข้อมูล Supabase สำหรับ: ระบบบัญชีกลางและจัดการการเงินรวม (Multi-Company Accounting Hub)
-- รองรับ Multi-Tenant Architecture, Role-Based Access Control (RBAC), และ Row Level Security (RLS)
-- ==============================================================================

-- 1. ตารางบริษัท (Companies)
CREATE TABLE IF NOT EXISTS public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) UNIQUE NOT NULL, -- เช่น comp_tech, comp_logistics, comp_retail
    name_th VARCHAR(255) NOT NULL,
    name_en VARCHAR(255),
    tax_id VARCHAR(13) NOT NULL,
    branch_code VARCHAR(10) DEFAULT '00000', -- 00000 = สำนักงานใหญ่
    address TEXT,
    phone VARCHAR(50),
    email VARCHAR(100),
    invite_code VARCHAR(64) UNIQUE, -- รหัสเชิญใช้งานเฉพาะบริษัท
    logo_url TEXT,
    currency VARCHAR(10) DEFAULT 'THB',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. ตารางข้อมูลโปรไฟล์และสิทธิ์ผู้ใช้งาน (User Profiles & Roles)
-- บทบาท: 'super_admin' (HQ บัญชีกลาง), 'company_manager' (ผู้บริหาร), 'accountant' (เจ้าหน้าที่บัญชี), 'auditor' (ผู้ตรวจสอบ)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('super_admin', 'company_manager', 'accountant', 'auditor')),
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL, -- NULL สำหรับ super_admin บัญชีกลาง
    avatar_url TEXT,
    phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. ตารางหมวดหมู่ทางบัญชี (Chart of Accounts / Categories)
CREATE TABLE IF NOT EXISTS public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE, -- NULL ถ้าเป็นหมวดหมู่กลางของระบบ
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    code VARCHAR(50), -- เช่น 41000 รายได้จากการบริการ, 51000 ต้นทุนขาย
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. ตารางธุรกรรมรายรับ-รายจ่าย (Transactions)
CREATE TABLE IF NOT EXISTS public.transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    transaction_no VARCHAR(50) NOT NULL, -- เช่น TX-2026-0001
    transaction_date DATE NOT NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('income', 'expense')),
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    category_name VARCHAR(255),
    description TEXT NOT NULL,
    reference_no VARCHAR(100), -- เลขที่ใบเสร็จ/ใบกำกับภาษีอ้างอิง
    counterparty_name VARCHAR(255), -- ลูกค้า หรือ ผู้จัดจำหน่าย/คู่ค้า
    counterparty_tax_id VARCHAR(13),
    
    -- ข้อมูลตัวเลขทางการเงินและภาษีไทย
    subtotal NUMERIC(15, 2) NOT NULL DEFAULT 0.00, -- ยอดก่อนภาษี
    has_vat BOOLEAN DEFAULT false,
    vat_type VARCHAR(20) DEFAULT 'none' CHECK (vat_type IN ('none', 'include', 'exclude')),
    vat_rate NUMERIC(5, 2) DEFAULT 7.00,
    vat_amount NUMERIC(15, 2) DEFAULT 0.00,
    
    has_wht BOOLEAN DEFAULT false,
    wht_rate NUMERIC(5, 2) DEFAULT 0.00, -- 1%, 2%, 3%, 5%
    wht_amount NUMERIC(15, 2) DEFAULT 0.00,
    
    total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0.00, -- ยอดรวมสุทธิที่จ่ายหรือรับจริง
    
    -- สถานะรายการและการอนุมัติ
    status VARCHAR(30) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'paid')),
    payment_method VARCHAR(50) DEFAULT 'bank_transfer', -- bank_transfer, cash, credit_card
    
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMP WITH TIME ZONE,
    rejection_reason TEXT,
    notes TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. ตารางเอกสารแนบ (Attachments & Proof of Payment)
CREATE TABLE IF NOT EXISTS public.attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES public.transactions(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_type VARCHAR(100), -- image/jpeg, application/pdf
    file_size INTEGER,
    storage_path TEXT NOT NULL, -- Path ใน Supabase Storage Bucket
    document_type VARCHAR(50) DEFAULT 'receipt' CHECK (document_type IN ('slip', 'receipt', 'tax_invoice', 'contract', 'other')),
    uploaded_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 6. ตารางบันทึกประวัติการกระทำ (Audit Log)
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL, -- เช่น 'CREATE_TRANSACTION', 'APPROVE_EXPENSE', 'EXPORT_REPORT'
    entity_type VARCHAR(50),
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==============================================================================
-- การตั้งค่า Row Level Security (RLS) เพื่อความปลอดภัยและการแบ่งแยก Workspace 100%
-- ==============================================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Helper Function: ตรวจสอบว่าเป็น Super Admin บัญชีกลางหรือไม่
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'super_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Helper Function: ดึง Company ID ของผู้ใช้งานปัจจุบัน
CREATE OR REPLACE FUNCTION public.current_user_company_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT company_id FROM public.profiles
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policies สำหรับ Companies: Super Admin ดูได้หมด, สิทธิ์อื่นดูเฉพาะบริษัทตนเอง
CREATE POLICY "Companies policy" ON public.companies
    FOR ALL
    USING (public.is_super_admin() OR id = public.current_user_company_id());

-- Policies สำหรับ Transactions: Super Admin ดูได้หมด, สิทธิ์อื่นเข้าถึงเฉพาะ Company ID ตนเอง
CREATE POLICY "Transactions view policy" ON public.transactions
    FOR SELECT
    USING (public.is_super_admin() OR company_id = public.current_user_company_id());

CREATE POLICY "Transactions insert policy" ON public.transactions
    FOR INSERT
    WITH CHECK (
        public.is_super_admin() OR 
        (company_id = public.current_user_company_id() AND EXISTS (
            SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('accountant', 'company_manager')
        ))
    );

CREATE POLICY "Transactions update policy" ON public.transactions
    FOR UPDATE
    USING (
        public.is_super_admin() OR 
        (company_id = public.current_user_company_id() AND EXISTS (
            SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('accountant', 'company_manager')
        ))
    );

-- Storage Bucket สำหรับเอกสารแนบ
-- INSERT INTO storage.buckets (id, name, public) VALUES ('accounting-documents', 'accounting-documents', true);
