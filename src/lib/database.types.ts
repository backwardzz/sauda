// Сгенерировано scripts/db-types.ts из схемы базы — не править вручную.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "canceled_items": {
                  Row: {
                    "cashier_id": string | null,"created_at": string,"id": string,"name": string,"org_id": string,"product_id": string | null,"qty_from": number,"qty_to": number,"register_id": string,"store_id": string
                  }
                  Insert: {
                    "cashier_id"?: string | null,"created_at"?: string,"id"?: string,"name": string,"org_id": string,"product_id"?: string | null,"qty_from": number,"qty_to": number,"register_id": string,"store_id": string
                  }
                  Update: {
                    "cashier_id"?: string | null,"created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"product_id"?: string | null,"qty_from"?: number,"qty_to"?: number,"register_id"?: string,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "canceled_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "canceled_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "canceled_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "canceled_items_register_id_fkey"
      columns: ["register_id"]
isOneToOne: false
      referencedRelation: "registers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "canceled_items_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["store_id"]
    },{
      foreignKeyName: "canceled_items_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"cash_ops": {
                  Row: {
                    "amount": number,"comment": string,"created_at": string,"id": string,"kind": string,"org_id": string,"shift_id": string,"user_id": string | null
                  }
                  Insert: {
                    "amount": number,"comment"?: string,"created_at"?: string,"id"?: string,"kind": string,"org_id": string,"shift_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "amount"?: number,"comment"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"org_id"?: string,"shift_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "cash_ops_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cash_ops_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shifts"
      referencedColumns: ["id"]
    }
                  ]
                },"catalog_companies": {
                  Row: {
                    "created_at": string,"logo_url": string,"name": string,"verified": boolean
                  }
                  Insert: {
                    "created_at"?: string,"logo_url"?: string,"name": string,"verified"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"logo_url"?: string,"name"?: string,"verified"?: boolean
                  }
                  Relationships: [
                    
                  ]
                },"catalog_products": {
                  Row: {
                    "barcode": string,"business": string,"category": string,"company": string,"created_at": string,"id": string,"name": string,"starter_pack": string,"subcategory": string,"unit": string,"updated_at": string
                  }
                  Insert: {
                    "barcode": string,"business"?: string,"category"?: string,"company"?: string,"created_at"?: string,"id"?: string,"name": string,"starter_pack"?: string,"subcategory"?: string,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "barcode"?: string,"business"?: string,"category"?: string,"company"?: string,"created_at"?: string,"id"?: string,"name"?: string,"starter_pack"?: string,"subcategory"?: string,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"categories": {
                  Row: {
                    "created_at": string,"id": string,"markup_pct": number,"name": string,"org_id": string,"parent_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"id"?: string,"markup_pct"?: number,"name": string,"org_id": string,"parent_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"markup_pct"?: number,"name"?: string,"org_id"?: string,"parent_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "categories_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "categories_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    }
                  ]
                },"cities": {
                  Row: {
                    "id": number,"name": string,"region_id": number
                  }
                  Insert: {
                    "id"?: never,"name": string,"region_id": number
                  }
                  Update: {
                    "id"?: never,"name"?: string,"region_id"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "cities_region_id_fkey"
      columns: ["region_id"]
isOneToOne: false
      referencedRelation: "regions"
      referencedColumns: ["id"]
    }
                  ]
                },"companies": {
                  Row: {
                    "company_type": string,"created_at": string,"delivery_note": string,"description": string,"min_order": number,"org_id": string,"payment_terms": string,"price_access": string,"updated_at": string,"verified": boolean,"website": string
                  }
                  Insert: {
                    "company_type"?: string,"created_at"?: string,"delivery_note"?: string,"description"?: string,"min_order"?: number,"org_id": string,"payment_terms"?: string,"price_access"?: string,"updated_at"?: string,"verified"?: boolean,"website"?: string
                  }
                  Update: {
                    "company_type"?: string,"created_at"?: string,"delivery_note"?: string,"description"?: string,"min_order"?: number,"org_id"?: string,"payment_terms"?: string,"price_access"?: string,"updated_at"?: string,"verified"?: boolean,"website"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "companies_org_id_fkey"
      columns: ["org_id"]
isOneToOne: true
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"company_api_keys": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"key_hash": string,"last_used_at": string | null,"name": string,"org_id": string,"prefix": string,"revoked_at": string | null
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"key_hash": string,"last_used_at"?: string | null,"name": string,"org_id": string,"prefix": string,"revoked_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"key_hash"?: string,"last_used_at"?: string | null,"name"?: string,"org_id"?: string,"prefix"?: string,"revoked_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_api_keys_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"company_branch_zones": {
                  Row: {
                    "branch_id": string,"city_id": number | null,"id": number,"org_id": string,"region_id": number | null
                  }
                  Insert: {
                    "branch_id": string,"city_id"?: number | null,"id"?: never,"org_id": string,"region_id"?: number | null
                  }
                  Update: {
                    "branch_id"?: string,"city_id"?: number | null,"id"?: never,"org_id"?: string,"region_id"?: number | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_branch_zones_branch_id_org_id_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "company_branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "company_branch_zones_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_branch_zones_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_branch_zones_region_id_fkey"
      columns: ["region_id"]
isOneToOne: false
      referencedRelation: "regions"
      referencedColumns: ["id"]
    }
                  ]
                },"company_branches": {
                  Row: {
                    "address": string,"city_id": number,"created_at": string,"delivery_note": string,"id": string,"is_main": boolean,"manager_name": string,"markup_pct": number,"min_order": number | null,"name": string,"org_id": string,"phone": string,"work_hours": string
                  }
                  Insert: {
                    "address"?: string,"city_id": number,"created_at"?: string,"delivery_note"?: string,"id"?: string,"is_main"?: boolean,"manager_name"?: string,"markup_pct"?: number,"min_order"?: number | null,"name": string,"org_id": string,"phone"?: string,"work_hours"?: string
                  }
                  Update: {
                    "address"?: string,"city_id"?: number,"created_at"?: string,"delivery_note"?: string,"id"?: string,"is_main"?: boolean,"manager_name"?: string,"markup_pct"?: number,"min_order"?: number | null,"name"?: string,"org_id"?: string,"phone"?: string,"work_hours"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_branches_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_branches_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"company_products": {
                  Row: {
                    "archived": boolean,"category": string,"created_at": string,"description": string,"id": string,"image_url": string,"name": string,"org_id": string,"updated_at": string
                  }
                  Insert: {
                    "archived"?: boolean,"category"?: string,"created_at"?: string,"description"?: string,"id"?: string,"image_url"?: string,"name": string,"org_id": string,"updated_at"?: string
                  }
                  Update: {
                    "archived"?: boolean,"category"?: string,"created_at"?: string,"description"?: string,"id"?: string,"image_url"?: string,"name"?: string,"org_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_products_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"company_stock": {
                  Row: {
                    "branch_id": string,"listed": boolean,"org_id": string,"price": number | null,"qty": number,"variant_id": string
                  }
                  Insert: {
                    "branch_id": string,"listed"?: boolean,"org_id": string,"price"?: number | null,"qty"?: number,"variant_id": string
                  }
                  Update: {
                    "branch_id"?: string,"listed"?: boolean,"org_id"?: string,"price"?: number | null,"qty"?: number,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_stock_branch_org_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "company_branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "company_stock_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_stock_variant_org_fkey"
      columns: ["variant_id","org_id"]
isOneToOne: false
      referencedRelation: "company_variants"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"company_stock_moves": {
                  Row: {
                    "branch_id": string,"comment": string,"created_at": string,"delta": number,"id": number,"order_id": string | null,"org_id": string,"qty_after": number,"reason": string,"user_id": string | null,"variant_id": string
                  }
                  Insert: {
                    "branch_id": string,"comment"?: string,"created_at"?: string,"delta": number,"id"?: never,"order_id"?: string | null,"org_id": string,"qty_after": number,"reason": string,"user_id"?: string | null,"variant_id": string
                  }
                  Update: {
                    "branch_id"?: string,"comment"?: string,"created_at"?: string,"delta"?: number,"id"?: never,"order_id"?: string | null,"org_id"?: string,"qty_after"?: number,"reason"?: string,"user_id"?: string | null,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_stock_moves_branch_org_fkey"
      columns: ["branch_id","org_id"]
isOneToOne: false
      referencedRelation: "company_branches"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "company_stock_moves_order_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_stock_moves_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_stock_moves_variant_org_fkey"
      columns: ["variant_id","org_id"]
isOneToOne: false
      referencedRelation: "company_variants"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"company_store_access": {
                  Row: {
                    "company_org": string,"decided_at": string | null,"decided_by": string | null,"requested_at": string,"requested_by": string | null,"status": string,"store_org": string
                  }
                  Insert: {
                    "company_org": string,"decided_at"?: string | null,"decided_by"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"status"?: string,"store_org": string
                  }
                  Update: {
                    "company_org"?: string,"decided_at"?: string | null,"decided_by"?: string | null,"requested_at"?: string,"requested_by"?: string | null,"status"?: string,"store_org"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_store_access_company_org_fkey"
      columns: ["company_org"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_store_access_store_org_fkey"
      columns: ["store_org"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"company_variant_limits": {
                  Row: {
                    "min_stock": number,"org_id": string,"variant_id": string
                  }
                  Insert: {
                    "min_stock": number,"org_id": string,"variant_id": string
                  }
                  Update: {
                    "min_stock"?: number,"org_id"?: string,"variant_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_variant_limits_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_variant_limits_variant_id_org_id_fkey"
      columns: ["variant_id","org_id"]
isOneToOne: false
      referencedRelation: "company_variants"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"company_variants": {
                  Row: {
                    "active": boolean,"archived": boolean,"barcode": string,"created_at": string,"id": string,"image_url": string,"label": string,"org_id": string,"pack_qty": number,"price": number,"product_id": string,"sort": number,"track_stock": boolean,"unit": string,"updated_at": string
                  }
                  Insert: {
                    "active"?: boolean,"archived"?: boolean,"barcode": string,"created_at"?: string,"id"?: string,"image_url"?: string,"label"?: string,"org_id": string,"pack_qty"?: number,"price"?: number,"product_id": string,"sort"?: number,"track_stock"?: boolean,"unit"?: string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"archived"?: boolean,"barcode"?: string,"created_at"?: string,"id"?: string,"image_url"?: string,"label"?: string,"org_id"?: string,"pack_qty"?: number,"price"?: number,"product_id"?: string,"sort"?: number,"track_stock"?: boolean,"unit"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "company_variants_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "company_variants_product_fkey"
      columns: ["product_id","org_id"]
isOneToOne: false
      referencedRelation: "company_products"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"contractors": {
                  Row: {
                    "comment": string,"created_at": string,"id": string,"kind": string,"name": string,"org_id": string,"partner_org_id": string | null,"phone": string
                  }
                  Insert: {
                    "comment"?: string,"created_at"?: string,"id"?: string,"kind": string,"name": string,"org_id": string,"partner_org_id"?: string | null,"phone"?: string
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"id"?: string,"kind"?: string,"name"?: string,"org_id"?: string,"partner_org_id"?: string | null,"phone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contractors_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contractors_partner_org_id_fkey"
      columns: ["partner_org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"doc_payments": {
                  Row: {
                    "amount": number,"comment": string,"created_at": string,"created_by": string | null,"doc_id": string,"id": string,"org_id": string
                  }
                  Insert: {
                    "amount": number,"comment"?: string,"created_at"?: string,"created_by"?: string | null,"doc_id": string,"id"?: string,"org_id": string
                  }
                  Update: {
                    "amount"?: number,"comment"?: string,"created_at"?: string,"created_by"?: string | null,"doc_id"?: string,"id"?: string,"org_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "doc_payments_doc_id_fkey"
      columns: ["doc_id"]
isOneToOne: false
      referencedRelation: "stock_docs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "doc_payments_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"fiscal_receipts": {
                  Row: {
                    "attempts": number,"cash_op_id": string | null,"created_at": string,"done_at": string | null,"fiscal_number": string | null,"id": string,"kind": string,"last_error": string | null,"offline": boolean,"org_id": string,"register_id": string,"response": Json | null,"sale_id": string | null,"shift_id": string,"status": string,"ticket_url": string | null
                  }
                  Insert: {
                    "attempts"?: number,"cash_op_id"?: string | null,"created_at"?: string,"done_at"?: string | null,"fiscal_number"?: string | null,"id"?: string,"kind": string,"last_error"?: string | null,"offline"?: boolean,"org_id": string,"register_id": string,"response"?: Json | null,"sale_id"?: string | null,"shift_id": string,"status"?: string,"ticket_url"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"cash_op_id"?: string | null,"created_at"?: string,"done_at"?: string | null,"fiscal_number"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"offline"?: boolean,"org_id"?: string,"register_id"?: string,"response"?: Json | null,"sale_id"?: string | null,"shift_id"?: string,"status"?: string,"ticket_url"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "fiscal_receipts_cash_op_id_fkey"
      columns: ["cash_op_id"]
isOneToOne: true
      referencedRelation: "cash_ops"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fiscal_receipts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fiscal_receipts_register_id_fkey"
      columns: ["register_id"]
isOneToOne: false
      referencedRelation: "registers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fiscal_receipts_sale_id_fkey"
      columns: ["sale_id"]
isOneToOne: true
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "fiscal_receipts_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shifts"
      referencedColumns: ["id"]
    }
                  ]
                },"invites": {
                  Row: {
                    "created_at": string,"email": string,"id": string,"org_id": string,"role": Database["public"]['Enums']["member_role"]
                  }
                  Insert: {
                    "created_at"?: string,"email": string,"id"?: string,"org_id": string,"role"?: Database["public"]['Enums']["member_role"]
                  }
                  Update: {
                    "created_at"?: string,"email"?: string,"id"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["member_role"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "invites_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "barcode": string,"id": string,"name": string,"order_id": string,"price": number,"qty": number,"qty_shipped": number | null,"store_org": string,"supplier_org": string,"unit": string,"variant_id": string | null
                  }
                  Insert: {
                    "barcode": string,"id"?: string,"name": string,"order_id": string,"price": number,"qty": number,"qty_shipped"?: number | null,"store_org": string,"supplier_org": string,"unit": string,"variant_id"?: string | null
                  }
                  Update: {
                    "barcode"?: string,"id"?: string,"name"?: string,"order_id"?: string,"price"?: number,"qty"?: number,"qty_shipped"?: number | null,"store_org"?: string,"supplier_org"?: string,"unit"?: string,"variant_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_parties_fkey"
      columns: ["order_id","supplier_org","store_org"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id","supplier_org","store_org"]
    },{
      foreignKeyName: "order_items_variant_id_fkey"
      columns: ["variant_id"]
isOneToOne: false
      referencedRelation: "company_variants"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "branch_id": string | null,"branch_name": string,"comment": string,"confirmed_at": string | null,"created_at": string,"created_by": string | null,"id": string,"number": number,"received_at": string | null,"shipped_at": string | null,"status": string,"store_address": string,"store_city": string,"store_city_id": number | null,"store_id": string,"store_name": string,"store_org": string,"store_org_name": string,"store_phone": string,"supplier_comment": string,"supplier_name": string,"supplier_org": string,"supply_doc": string | null,"total": number
                  }
                  Insert: {
                    "branch_id"?: string | null,"branch_name"?: string,"comment"?: string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"number": number,"received_at"?: string | null,"shipped_at"?: string | null,"status"?: string,"store_address"?: string,"store_city"?: string,"store_city_id"?: number | null,"store_id": string,"store_name": string,"store_org": string,"store_org_name": string,"store_phone"?: string,"supplier_comment"?: string,"supplier_name": string,"supplier_org": string,"supply_doc"?: string | null,"total"?: number
                  }
                  Update: {
                    "branch_id"?: string | null,"branch_name"?: string,"comment"?: string,"confirmed_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"id"?: string,"number"?: number,"received_at"?: string | null,"shipped_at"?: string | null,"status"?: string,"store_address"?: string,"store_city"?: string,"store_city_id"?: number | null,"store_id"?: string,"store_name"?: string,"store_org"?: string,"store_org_name"?: string,"store_phone"?: string,"supplier_comment"?: string,"supplier_name"?: string,"supplier_org"?: string,"supply_doc"?: string | null,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_branch_id_fkey"
      columns: ["branch_id"]
isOneToOne: false
      referencedRelation: "company_branches"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_store_city_id_fkey"
      columns: ["store_city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["store_id"]
    },{
      foreignKeyName: "orders_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_store_org_fkey"
      columns: ["store_org"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_supplier_org_fkey"
      columns: ["supplier_org"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_supply_doc_fkey"
      columns: ["supply_doc"]
isOneToOne: false
      referencedRelation: "stock_docs"
      referencedColumns: ["id"]
    }
                  ]
                },"org_counters": {
                  Row: {
                    "key": string,"org_id": string,"value": number
                  }
                  Insert: {
                    "key": string,"org_id": string,"value": number
                  }
                  Update: {
                    "key"?: string,"org_id"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_counters_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"org_members": {
                  Row: {
                    "created_at": string,"org_id": string,"role": Database["public"]['Enums']["member_role"],"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"org_id": string,"role"?: Database["public"]['Enums']["member_role"],"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"org_id"?: string,"role"?: Database["public"]['Enums']["member_role"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "org_members_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"orgs": {
                  Row: {
                    "bin": string,"business": string,"contact_name": string,"created_at": string,"currency": string,"email": string,"id": string,"kind": string,"logo_url": string,"name": string,"phone": string,"timezone": string,"vat_rate": number | null
                  }
                  Insert: {
                    "bin"?: string,"business"?: string,"contact_name"?: string,"created_at"?: string,"currency"?: string,"email"?: string,"id"?: string,"kind"?: string,"logo_url"?: string,"name": string,"phone"?: string,"timezone"?: string,"vat_rate"?: number | null
                  }
                  Update: {
                    "bin"?: string,"business"?: string,"contact_name"?: string,"created_at"?: string,"currency"?: string,"email"?: string,"id"?: string,"kind"?: string,"logo_url"?: string,"name"?: string,"phone"?: string,"timezone"?: string,"vat_rate"?: number | null
                  }
                  Relationships: [
                    
                  ]
                },"products": {
                  Row: {
                    "archived": boolean,"barcode": string,"category_id": string | null,"created_at": string,"extra_barcodes": (string)[],"id": string,"kind": string,"min_stock": number | null,"name": string,"org_id": string,"pack_qty": number | null,"pack_unit": string | null,"package": string | null,"percent": number | null,"purchase_price": number,"quick_group_id": string | null,"quick_name": string,"quick_sort": number,"sale_price": number,"size_unit": string | null,"size_value": number | null,"sku": string,"supplier_id": string | null,"title": string,"unit": string,"updated_at": string,"wholesale_price": number
                  }
                  Insert: {
                    "archived"?: boolean,"barcode": string,"category_id"?: string | null,"created_at"?: string,"extra_barcodes"?: (string)[],"id"?: string,"kind"?: string,"min_stock"?: number | null,"name": string,"org_id": string,"pack_qty"?: number | null,"pack_unit"?: string | null,"package"?: string | null,"percent"?: number | null,"purchase_price"?: number,"quick_group_id"?: string | null,"quick_name"?: string,"quick_sort"?: number,"sale_price"?: number,"size_unit"?: string | null,"size_value"?: number | null,"sku"?: string,"supplier_id"?: string | null,"title"?: string,"unit"?: string,"updated_at"?: string,"wholesale_price"?: number
                  }
                  Update: {
                    "archived"?: boolean,"barcode"?: string,"category_id"?: string | null,"created_at"?: string,"extra_barcodes"?: (string)[],"id"?: string,"kind"?: string,"min_stock"?: number | null,"name"?: string,"org_id"?: string,"pack_qty"?: number | null,"pack_unit"?: string | null,"package"?: string | null,"percent"?: number | null,"purchase_price"?: number,"quick_group_id"?: string | null,"quick_name"?: string,"quick_sort"?: number,"sale_price"?: number,"size_unit"?: string | null,"size_value"?: number | null,"sku"?: string,"supplier_id"?: string | null,"title"?: string,"unit"?: string,"updated_at"?: string,"wholesale_price"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_quick_group_id_fkey"
      columns: ["quick_group_id"]
isOneToOne: false
      referencedRelation: "quick_groups"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "contractors"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "email": string,"full_name": string,"id": string
                  }
                  Insert: {
                    "email"?: string,"full_name"?: string,"id": string
                  }
                  Update: {
                    "email"?: string,"full_name"?: string,"id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"quick_groups": {
                  Row: {
                    "id": string,"name": string,"org_id": string,"sort": number
                  }
                  Insert: {
                    "id"?: string,"name": string,"org_id": string,"sort"?: number
                  }
                  Update: {
                    "id"?: string,"name"?: string,"org_id"?: string,"sort"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "quick_groups_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                },"regions": {
                  Row: {
                    "id": number,"name": string,"sort": number
                  }
                  Insert: {
                    "id"?: never,"name": string,"sort": number
                  }
                  Update: {
                    "id"?: never,"name"?: string,"sort"?: number
                  }
                  Relationships: [
                    
                  ]
                },"register_fiscal": {
                  Row: {
                    "cashbox": string,"enabled": boolean,"login": string,"org_id": string,"password_secret": string,"provider": string,"register_id": string,"updated_at": string
                  }
                  Insert: {
                    "cashbox": string,"enabled"?: boolean,"login": string,"org_id": string,"password_secret": string,"provider"?: string,"register_id": string,"updated_at"?: string
                  }
                  Update: {
                    "cashbox"?: string,"enabled"?: boolean,"login"?: string,"org_id"?: string,"password_secret"?: string,"provider"?: string,"register_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "register_fiscal_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "register_fiscal_register_id_fkey"
      columns: ["register_id"]
isOneToOne: true
      referencedRelation: "registers"
      referencedColumns: ["id"]
    }
                  ]
                },"registers": {
                  Row: {
                    "active": boolean,"created_at": string,"id": string,"name": string,"org_id": string,"receipt_footer": string,"receipt_header": string,"store_id": string
                  }
                  Insert: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name": string,"org_id": string,"receipt_footer"?: string,"receipt_header"?: string,"store_id": string
                  }
                  Update: {
                    "active"?: boolean,"created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"receipt_footer"?: string,"receipt_header"?: string,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "registers_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "registers_store_org_fkey"
      columns: ["store_id","org_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"sale_items": {
                  Row: {
                    "barcode": string,"category_id": string | null,"cost": number,"discount": number,"id": string,"name": string,"org_id": string,"parent_item_id": string | null,"price": number,"product_id": string,"qty": number,"sale_id": string,"supplier_id": string | null,"total": number,"unit": string
                  }
                  Insert: {
                    "barcode": string,"category_id"?: string | null,"cost"?: number,"discount"?: number,"id"?: string,"name": string,"org_id": string,"parent_item_id"?: string | null,"price": number,"product_id": string,"qty": number,"sale_id": string,"supplier_id"?: string | null,"total": number,"unit": string
                  }
                  Update: {
                    "barcode"?: string,"category_id"?: string | null,"cost"?: number,"discount"?: number,"id"?: string,"name"?: string,"org_id"?: string,"parent_item_id"?: string | null,"price"?: number,"product_id"?: string,"qty"?: number,"sale_id"?: string,"supplier_id"?: string | null,"total"?: number,"unit"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sale_items_category_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_parent_item_id_fkey"
      columns: ["parent_item_id"]
isOneToOne: false
      referencedRelation: "sale_items"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sale_items_sale_org_fkey"
      columns: ["sale_id","org_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "sale_items_supplier_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "contractors"
      referencedColumns: ["id"]
    }
                  ]
                },"sales": {
                  Row: {
                    "cashier_id": string | null,"client_id": string | null,"comment": string,"cost": number,"created_at": string,"customer_id": string | null,"discount": number,"id": string,"kind": string,"number": number,"org_id": string,"paid_card": number,"paid_cash": number,"parent_id": string | null,"register_id": string,"shift_id": string,"store_id": string,"subtotal": number,"total": number
                  }
                  Insert: {
                    "cashier_id"?: string | null,"client_id"?: string | null,"comment"?: string,"cost"?: number,"created_at"?: string,"customer_id"?: string | null,"discount"?: number,"id"?: string,"kind": string,"number": number,"org_id": string,"paid_card"?: number,"paid_cash"?: number,"parent_id"?: string | null,"register_id": string,"shift_id": string,"store_id": string,"subtotal"?: number,"total"?: number
                  }
                  Update: {
                    "cashier_id"?: string | null,"client_id"?: string | null,"comment"?: string,"cost"?: number,"created_at"?: string,"customer_id"?: string | null,"discount"?: number,"id"?: string,"kind"?: string,"number"?: number,"org_id"?: string,"paid_card"?: number,"paid_cash"?: number,"parent_id"?: string | null,"register_id"?: string,"shift_id"?: string,"store_id"?: string,"subtotal"?: number,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "contractors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_parent_id_fkey"
      columns: ["parent_id"]
isOneToOne: false
      referencedRelation: "sales"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_register_id_fkey"
      columns: ["register_id"]
isOneToOne: false
      referencedRelation: "registers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_shift_id_fkey"
      columns: ["shift_id"]
isOneToOne: false
      referencedRelation: "shifts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sales_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["store_id"]
    },{
      foreignKeyName: "sales_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"shifts": {
                  Row: {
                    "cashier_id": string | null,"closed_at": string | null,"closing_cash": number | null,"expected_cash": number | null,"id": string,"number": number,"opened_at": string,"opening_cash": number,"org_id": string,"register_id": string,"store_id": string
                  }
                  Insert: {
                    "cashier_id"?: string | null,"closed_at"?: string | null,"closing_cash"?: number | null,"expected_cash"?: number | null,"id"?: string,"number": number,"opened_at"?: string,"opening_cash"?: number,"org_id": string,"register_id": string,"store_id": string
                  }
                  Update: {
                    "cashier_id"?: string | null,"closed_at"?: string | null,"closing_cash"?: number | null,"expected_cash"?: number | null,"id"?: string,"number"?: number,"opened_at"?: string,"opening_cash"?: number,"org_id"?: string,"register_id"?: string,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shifts_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shifts_register_id_fkey"
      columns: ["register_id"]
isOneToOne: false
      referencedRelation: "registers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shifts_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["store_id"]
    },{
      foreignKeyName: "shifts_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"stock": {
                  Row: {
                    "org_id": string,"product_id": string,"qty": number,"store_id": string
                  }
                  Insert: {
                    "org_id": string,"product_id": string,"qty"?: number,"store_id": string
                  }
                  Update: {
                    "org_id"?: string,"product_id"?: string,"qty"?: number,"store_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_product_org_fkey"
      columns: ["product_id","org_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "stock_product_org_fkey"
      columns: ["product_id","org_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "stock_store_org_fkey"
      columns: ["store_id","org_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"stock_doc_items": {
                  Row: {
                    "doc_id": string,"expected": number | null,"id": string,"org_id": string,"price": number,"product_id": string,"qty": number,"sale_price": number | null,"updated_at": string
                  }
                  Insert: {
                    "doc_id": string,"expected"?: number | null,"id"?: string,"org_id": string,"price"?: number,"product_id": string,"qty": number,"sale_price"?: number | null,"updated_at"?: string
                  }
                  Update: {
                    "doc_id"?: string,"expected"?: number | null,"id"?: string,"org_id"?: string,"price"?: number,"product_id"?: string,"qty"?: number,"sale_price"?: number | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_doc_items_doc_org_fkey"
      columns: ["doc_id","org_id"]
isOneToOne: false
      referencedRelation: "stock_docs"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "stock_doc_items_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_doc_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_doc_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_docs": {
                  Row: {
                    "comment": string,"created_at": string,"created_by": string | null,"id": string,"kind": string,"number": number,"org_id": string,"paid": number,"status": string,"store_id": string,"supplier_id": string | null,"to_store_id": string | null,"total": number
                  }
                  Insert: {
                    "comment"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind": string,"number": number,"org_id": string,"paid"?: number,"status"?: string,"store_id": string,"supplier_id"?: string | null,"to_store_id"?: string | null,"total"?: number
                  }
                  Update: {
                    "comment"?: string,"created_at"?: string,"created_by"?: string | null,"id"?: string,"kind"?: string,"number"?: number,"org_id"?: string,"paid"?: number,"status"?: string,"store_id"?: string,"supplier_id"?: string | null,"to_store_id"?: string | null,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_docs_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_docs_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["store_id"]
    },{
      foreignKeyName: "stock_docs_store_id_fkey"
      columns: ["store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_docs_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "contractors"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_docs_to_store_id_fkey"
      columns: ["to_store_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["store_id"]
    },{
      foreignKeyName: "stock_docs_to_store_id_fkey"
      columns: ["to_store_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id"]
    }
                  ]
                },"stock_moves": {
                  Row: {
                    "created_at": string,"delta": number,"id": number,"org_id": string,"product_id": string,"qty_after": number,"reason": string,"ref_id": string | null,"ref_number": number | null,"store_id": string,"user_id": string | null
                  }
                  Insert: {
                    "created_at"?: string,"delta": number,"id"?: never,"org_id": string,"product_id": string,"qty_after": number,"reason": string,"ref_id"?: string | null,"ref_number"?: number | null,"store_id": string,"user_id"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"delta"?: number,"id"?: never,"org_id"?: string,"product_id"?: string,"qty_after"?: number,"reason"?: string,"ref_id"?: string | null,"ref_number"?: number | null,"store_id"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_moves_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stock_moves_product_org_fkey"
      columns: ["product_id","org_id"]
isOneToOne: false
      referencedRelation: "product_stock"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "stock_moves_product_org_fkey"
      columns: ["product_id","org_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id","org_id"]
    },{
      foreignKeyName: "stock_moves_store_org_fkey"
      columns: ["store_id","org_id"]
isOneToOne: false
      referencedRelation: "stores"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"stores": {
                  Row: {
                    "address": string,"city_id": number | null,"created_at": string,"id": string,"name": string,"org_id": string,"phone": string
                  }
                  Insert: {
                    "address"?: string,"city_id"?: number | null,"created_at"?: string,"id"?: string,"name": string,"org_id": string,"phone"?: string
                  }
                  Update: {
                    "address"?: string,"city_id"?: number | null,"created_at"?: string,"id"?: string,"name"?: string,"org_id"?: string,"phone"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stores_city_id_fkey"
      columns: ["city_id"]
isOneToOne: false
      referencedRelation: "cities"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "stores_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "product_stock": {
                  Row: {
                    "archived": boolean | null,"barcode": string | null,"category_id": string | null,"id": string | null,"low": boolean | null,"min_stock": number | null,"name": string | null,"org_id": string | null,"purchase_price": number | null,"purchase_sum": number | null,"qty": number | null,"sale_price": number | null,"sale_sum": number | null,"sku": string | null,"store_id": string | null,"supplier_id": string | null,"unit": string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "products_category_id_fkey"
      columns: ["category_id"]
isOneToOne: false
      referencedRelation: "categories"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "orgs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "products_supplier_id_fkey"
      columns: ["supplier_id"]
isOneToOne: false
      referencedRelation: "contractors"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Functions: {
            "accept_invites":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"add_catalog_products":
{ Args: { "p_ids": (string)[] | null,"p_org": string | null,"p_prices"?: unknown}; Returns: Json
                           },
"api_branches":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"api_catalog":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"api_ping":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"api_stock":
{ Args: { "branch"?: string | null,"items": unknown}; Returns: Json
                           },
"archive_company_product":
{ Args: { "p_archived"?: boolean | null,"p_product": string | null}; Returns: undefined
                           },
"cash_op":
{ Args: { "p_amount": number | null,"p_comment"?: string | null,"p_kind": string | null,"p_shift": string | null}; Returns: string
                           },
"catalog_categories":
{ Args: { "p_org": string | null}; Returns: {
              "category": string,"cnt": number,"subcategory": string
            }[]
                           },
"catalog_company_list":
{ Args: { "p_category"?: string | null,"p_org": string | null,"p_subcategory"?: string | null}; Returns: {
              "cnt": number,"company": string,"logo_url": string,"mine": number,"verified": boolean
            }[]
                           },
"catalog_search":
{ Args: { "p_category"?: string | null,"p_company"?: string | null,"p_limit"?: number | null,"p_offset"?: number | null,"p_only_new"?: boolean | null,"p_only_offers"?: boolean | null,"p_org": string | null,"p_subcategory"?: string | null,"p_term"?: string | null}; Returns: {
              "barcode": string,"category": string,"company": string,"id": string,"mine": boolean,"name": string,"offers": number,"subcategory": string,"total": number,"unit": string
            }[]
                           },
"close_shift":
{ Args: { "p_closing_cash": number | null,"p_shift": string | null}; Returns: number
                           },
"company_directory":
{ Args: Record<PropertyKey, never>; Returns: {
              "categories": (string)[],"cities": (string)[],"city_ids": (number)[],"company_type": string,"delivery_note": string,"description": string,"id": string,"images": (string)[],"logo_url": string,"min_order": number,"name": string,"payment_terms": string,"phone": string,"products": number,"verified": boolean
            }[]
                           },
"company_geo":
{ Args: { "p_from": string | null,"p_org": string | null,"p_to": string | null}; Returns: Json
                           },
"company_stats":
{ Args: { "p_org": string | null}; Returns: {
              "last_sold_at": string,"orders_count": number,"reserved": number,"sold_qty": number,"sold_qty_30": number,"sold_sum": number,"stock": number,"stores_count": number,"variant_id": string
            }[]
                           },
"create_api_key":
{ Args: { "p_name": string | null,"p_org": string | null}; Returns: string
                           },
"create_org":
{ Args: { "p_business"?: string | null,"p_city"?: number | null,"p_kind"?: string | null,"p_name": string | null,"p_profile"?: unknown,"p_store"?: string | null}; Returns: string
                           },
"create_return":
{ Args: { "p_comment"?: string | null,"p_items": unknown,"p_refund_card"?: number | null,"p_sale": string | null,"p_shift": string | null}; Returns: Json
                           },
"create_sale":
{ Args: { "p_client_id"?: string | null,"p_comment"?: string | null,"p_customer"?: string | null,"p_items": unknown,"p_paid_card"?: number | null,"p_shift": string | null}; Returns: Json
                           },
"create_stock_doc":
{ Args: { "p_comment"?: string | null,"p_kind": string | null,"p_store": string | null,"p_supplier"?: string | null,"p_to_store"?: string | null}; Returns: string
                           },
"decide_price_access":
{ Args: { "p_company": string | null,"p_status": string | null,"p_store_org": string | null}; Returns: undefined
                           },
"delete_company_branch":
{ Args: { "p_branch": string | null}; Returns: undefined
                           },
"delete_register_fiscal":
{ Args: { "p_register": string | null}; Returns: undefined
                           },
"delete_stock_doc":
{ Args: { "p_doc": string | null}; Returns: undefined
                           },
"fiscal_credentials":
{ Args: { "p_register": string | null}; Returns: Json
                           },
"import_company_products":
{ Args: { "p_branch"?: string | null,"p_org": string | null,"p_rows": unknown}; Returns: Json
                           },
"import_company_stock":
{ Args: { "p_org": string | null,"p_rows": unknown}; Returns: Json
                           },
"import_products":
{ Args: { "p_org": string | null,"p_rows": unknown,"p_store": string | null}; Returns: Json
                           },
"log_cancel":
{ Args: { "p_name": string | null,"p_product": string | null,"p_qty_from": number | null,"p_qty_to": number | null,"p_register": string | null}; Returns: undefined
                           },
"open_shift":
{ Args: { "p_opening_cash"?: number | null,"p_register": string | null}; Returns: string
                           },
"pay_supply":
{ Args: { "p_amount": number | null,"p_comment"?: string | null,"p_doc": string | null}; Returns: string
                           },
"place_order":
{ Args: { "p_comment"?: string | null,"p_items": unknown,"p_store": string | null,"p_supplier": string | null}; Returns: string
                           },
"post_stock_doc":
{ Args: { "p_comment": string | null,"p_items": unknown,"p_kind": string | null,"p_store": string | null,"p_supplier"?: string | null,"p_to_store"?: string | null}; Returns: string
                           },
"post_stock_doc_draft":
{ Args: { "p_doc": string | null,"p_zero_missing"?: boolean | null}; Returns: string
                           },
"price_access":
{ Args: { "p_company": string | null,"p_store_org": string | null}; Returns: Json
                           },
"price_access_list":
{ Args: { "p_company": string | null}; Returns: {
              "city": string,"decided_at": string,"orders": number,"phone": string,"requested_at": string,"status": string,"store_name": string,"store_org": string
            }[]
                           },
"receive_order":
{ Args: { "p_order": string | null}; Returns: string
                           },
"report_cashiers":
{ Args: { "p_from": string | null,"p_org": string | null,"p_store"?: string | null,"p_to": string | null}; Returns: {
              "card_sum": number,"cash_sum": number,"cashier_id": string,"cashier_name": string,"receipts": number,"returns_sum": number,"sales_sum": number,"total": number
            }[]
                           },
"report_pnl":
{ Args: { "p_from": string | null,"p_org": string | null,"p_store"?: string | null,"p_to": string | null}; Returns: {
              "cost_returned": number,"cost_sold": number,"discount": number,"inventory": number,"receipts": number,"returns_sum": number,"sales_card": number,"sales_cash": number,"writeoffs": number
            }[]
                           },
"report_sales":
{ Args: { "p_from": string | null,"p_group"?: string | null,"p_org": string | null,"p_store"?: string | null,"p_to": string | null}; Returns: {
              "barcode": string,"cost": number,"discount": number,"key": string,"label": string,"profit": number,"qty_returned": number,"qty_sold": number,"receipts": number,"returns_sum": number,"revenue": number,"sales_sum": number,"unit": string
            }[]
                           },
"report_shifts":
{ Args: { "p_from": string | null,"p_org": string | null,"p_store"?: string | null,"p_to": string | null}; Returns: {
              "cash_in": number,"cash_out": number,"cashier_name": string,"closed_at": string,"closing_cash": number,"cost": number,"expected_cash": number,"id": string,"number": number,"opened_at": string,"opening_cash": number,"profit": number,"receipts": number,"register_name": string,"returns_card": number,"returns_cash": number,"sales_card": number,"sales_cash": number
            }[]
                           },
"request_price_access":
{ Args: { "p_company": string | null,"p_store_org": string | null}; Returns: string
                           },
"revoke_api_key":
{ Args: { "p_key": string | null}; Returns: undefined
                           },
"save_company_product":
{ Args: { "p_org": string | null,"p_product": unknown,"p_variants": unknown}; Returns: string
                           },
"set_branch_listed":
{ Args: { "p_branch": string | null,"p_listed": boolean | null,"p_variant": string | null}; Returns: undefined
                           },
"set_branch_price":
{ Args: { "p_branch": string | null,"p_price": number | null,"p_variant": string | null}; Returns: undefined
                           },
"set_branch_zones":
{ Args: { "p_branch": string | null,"p_cities": (number)[] | null,"p_regions": (number)[] | null}; Returns: undefined
                           },
"set_company_stock":
{ Args: { "p_branch": string | null,"p_comment"?: string | null,"p_qty": number | null,"p_variant": string | null}; Returns: number
                           },
"set_main_branch":
{ Args: { "p_branch": string | null}; Returns: undefined
                           },
"set_order_branch":
{ Args: { "p_branch": string | null,"p_order": string | null}; Returns: undefined
                           },
"set_order_status":
{ Args: { "p_comment"?: string | null,"p_items"?: unknown,"p_order": string | null,"p_status": string | null}; Returns: undefined
                           },
"set_register_fiscal":
{ Args: { "p_cashbox": string | null,"p_enabled": boolean | null,"p_login": string | null,"p_password": string | null,"p_register": string | null}; Returns: undefined
                           },
"set_stock_doc_item":
{ Args: { "p_doc": string | null,"p_price"?: number | null,"p_product": string | null,"p_qty": number | null,"p_sale_price"?: number | null}; Returns: undefined
                           },
"starter_products":
{ Args: { "p_org": string | null}; Returns: {
              "barcode": string,"category": string,"id": string,"mine": boolean,"name": string,"starter_pack": string,"subcategory": string,"unit": string
            }[]
                           },
"stock_doc_lines":
{ Args: { "p_doc": string | null}; Returns: {
              "barcode": string,"card_purchase": number,"card_sale": number,"expected": number,"name": string,"price": number,"product_id": string,"qty": number,"sale_price": number,"stock": number,"unit": string,"updated_at": string
            }[]
                           },
"stock_totals":
{ Args: { "p_store": string | null}; Returns: {
              "positions": number,"purchase_sum": number,"qty": number,"sale_sum": number
            }[]
                           },
"store_offers":
{ Args: { "p_barcodes"?: (string)[] | null,"p_company"?: string | null,"p_store": string | null,"p_variants"?: (string)[] | null}; Returns: {
              "barcode": string,"branch_id": string,"branch_name": string,"category": string,"company_id": string,"company_name": string,"description": string,"free": number,"image_url": string,"label": string,"local": boolean,"min_order": number,"pack_qty": number,"price": number,"product_id": string,"product_name": string,"unit": string,"variant_id": string
            }[]
                           },
"update_stock_doc":
{ Args: { "p_comment": string | null,"p_doc": string | null,"p_supplier"?: string | null,"p_to_store"?: string | null}; Returns: undefined
                           }
          }
          Enums: {
            "member_role": "owner"|"manager"|"cashier"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "member_role": ["owner", "manager", "cashier"]
          }
        }
} as const
