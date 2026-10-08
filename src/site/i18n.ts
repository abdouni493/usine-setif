export type SiteLang = 'fr' | 'ar' | 'en';

const fr = {
  home: 'Accueil', products: 'Nos produits', about: 'À propos', cart: 'Panier', login: 'Connexion', logout: 'Déconnexion',
  aboutUs: 'À propos de nous', ourProducts: 'Nos produits', search: 'Rechercher un produit…', all: 'Tous',
  addToCart: 'Ajouter au panier', orderNow: 'Commander', added: 'Ajouté au panier', details: 'Détails',
  price: 'Prix', unitPrice: 'Prix unitaire', quantity: 'Quantité', total: 'Total', grandTotal: 'Total à payer',
  emptyCart: 'Votre panier est vide', browse: 'Voir les produits', addMore: 'Ajouter d’autres produits',
  yourInfo: 'Vos informations', name: 'Nom complet', phone: 'Téléphone', address: 'Adresse', note: 'Note',
  fiscal: 'Identifiants fiscaux (facultatif)', message: 'Message (facultatif)', placeOrder: 'Passer la commande',
  sending: 'Envoi…', orderSent: 'Commande envoyée !', orderRef: 'Référence',
  orderThanks: 'Merci ! Nous vous contacterons très vite pour confirmer.',
  continueShopping: 'Continuer mes achats', loggedAs: 'Commande au nom de', required: 'Nom et téléphone obligatoires',
  email: 'E-mail', password: 'Mot de passe', signIn: 'Se connecter', privateSite: 'Espace réservé aux clients',
  privateHint: 'Connectez-vous avec l’accès fourni par notre équipe.', badLogin: 'E-mail ou mot de passe incorrect',
  notClient: 'Ce compte n’est pas un compte client', contactUs: 'Nous contacter', follow: 'Suivez-nous',
  gallery: 'Quelques produits', noProducts: 'Aucun produit trouvé', loading: 'Chargement…', remove: 'Retirer',
  welcome: 'Bienvenue', rights: 'Tous droits réservés', back: 'Retour',
};
type Dict = typeof fr;

const ar: Dict = {
  home: 'الرئيسية', products: 'منتجاتنا', about: 'من نحن', cart: 'السلة', login: 'تسجيل الدخول', logout: 'خروج',
  aboutUs: 'من نحن', ourProducts: 'منتجاتنا', search: 'ابحث عن منتج…', all: 'الكل',
  addToCart: 'أضف إلى السلة', orderNow: 'اطلب الآن', added: 'أضيف إلى السلة', details: 'التفاصيل',
  price: 'السعر', unitPrice: 'سعر الوحدة', quantity: 'الكمية', total: 'المجموع', grandTotal: 'المبلغ الإجمالي',
  emptyCart: 'سلتك فارغة', browse: 'تصفح المنتجات', addMore: 'أضف منتجات أخرى',
  yourInfo: 'معلوماتك', name: 'الاسم الكامل', phone: 'الهاتف', address: 'العنوان', note: 'ملاحظة',
  fiscal: 'المعرفات الجبائية (اختياري)', message: 'رسالة (اختياري)', placeOrder: 'تأكيد الطلب',
  sending: 'جارٍ الإرسال…', orderSent: 'تم إرسال الطلب!', orderRef: 'المرجع',
  orderThanks: 'شكراً! سنتصل بك قريباً للتأكيد.',
  continueShopping: 'مواصلة التسوق', loggedAs: 'الطلب باسم', required: 'الاسم والهاتف إلزاميان',
  email: 'البريد الإلكتروني', password: 'كلمة المرور', signIn: 'دخول', privateSite: 'فضاء خاص بالعملاء',
  privateHint: 'سجّل الدخول بالحساب الذي قدّمه فريقنا.', badLogin: 'البريد أو كلمة المرور غير صحيحة',
  notClient: 'هذا الحساب ليس حساب عميل', contactUs: 'اتصل بنا', follow: 'تابعونا',
  gallery: 'بعض منتجاتنا', noProducts: 'لا توجد منتجات', loading: 'جارٍ التحميل…', remove: 'حذف',
  welcome: 'مرحباً', rights: 'جميع الحقوق محفوظة', back: 'رجوع',
};

const en: Dict = {
  home: 'Home', products: 'Our products', about: 'About', cart: 'Cart', login: 'Sign in', logout: 'Sign out',
  aboutUs: 'About us', ourProducts: 'Our products', search: 'Search a product…', all: 'All',
  addToCart: 'Add to cart', orderNow: 'Order now', added: 'Added to cart', details: 'Details',
  price: 'Price', unitPrice: 'Unit price', quantity: 'Quantity', total: 'Total', grandTotal: 'Total due',
  emptyCart: 'Your cart is empty', browse: 'Browse products', addMore: 'Add more products',
  yourInfo: 'Your details', name: 'Full name', phone: 'Phone', address: 'Address', note: 'Note',
  fiscal: 'Tax identifiers (optional)', message: 'Message (optional)', placeOrder: 'Place order',
  sending: 'Sending…', orderSent: 'Order sent!', orderRef: 'Reference',
  orderThanks: 'Thank you! We will contact you shortly to confirm.',
  continueShopping: 'Continue shopping', loggedAs: 'Ordering as', required: 'Name and phone are required',
  email: 'Email', password: 'Password', signIn: 'Sign in', privateSite: 'Customers area',
  privateHint: 'Sign in with the access provided by our team.', badLogin: 'Wrong email or password',
  notClient: 'This account is not a customer account', contactUs: 'Contact us', follow: 'Follow us',
  gallery: 'Some of our products', noProducts: 'No products found', loading: 'Loading…', remove: 'Remove',
  welcome: 'Welcome', rights: 'All rights reserved', back: 'Back',
};

export const siteDict: Record<SiteLang, Dict> = { fr, ar, en };
export type SiteKey = keyof Dict;
