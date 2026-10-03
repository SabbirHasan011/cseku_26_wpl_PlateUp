import { state } from './state.js';
import { notify,dismissNotice } from './feedback.js';
import { toggleNavigation } from './ui.js';
import { openBusinessSignup } from './auth.js';
import { openItemPricing,importItemHistory,trainItemModel,useItemSample } from './pricing.js';
import { closeModal } from './ui.js';
import { toggleCategoryEditor, saveFoodCategory, openOfferTimePicker, closeOfferTimePicker, previewFoodImage, submitNewListing, setOfferTimeStage, selectOfferTimePart, submitDailyQuantity, openEditListingModal, deleteListing, openNewListingModal } from './listings.js';
import { submitCustomerReview, openReviewModal, deleteReview, submitReviewReply, showReviewSlide } from './reviews.js';
import { reserveDetail, stepDetailQuantity, updateDetailQuantity, openListingDetails, filterCategory, filterListings, clearListingFilters, refreshMarketplace } from './marketplace.js';
import { clearCart, confirmOrder, openCheckoutModal, removeCartItem, stepCartQuantity, changeCartQuantity } from './cart.js';
import { markNotificationsRead, openNotificationOrder, markNotificationRead, openNotifications } from './notifications.js';
import { verifyPickup, rejectOrder, openPickupVerification, changeOrder, openRejectOrder, loadMyOrders, setOrderTab } from './orders.js';
import { changePassword, handleLogout, switchAuthMode, selectRole, handleLogin, openForgotPassword, handleSignup, openPasswordChange, requestPasswordReset, resetPassword } from './auth.js';
import { showScreen } from './router.js';
import { toggleFavorite } from './favorites.js';
import { openRestaurant, renderRestaurantMenu, loadRestaurant, renderRestaurants, loadRestaurants } from './restaurants.js';
import { openCitySettings, saveBusinessProfile, saveProfile } from './profile.js';
import { switchBizTab, loadBusiness, loadDailyAnalytics, exportDailyAnalytics } from './business.js';
import { showHomeBanner, toggleHomeBannerPlayback } from './home.js';
import { loadTrainingData, downloadTrainingFile, resetTrainingImport, importTrainingFile, generateTrainingSample, saveTrainingSample } from './training.js';

// Only these explicit actions can be invoked from static or generated markup.
export const actions = {
  loadBusiness: () => loadBusiness(),
  dismissNotice: () => dismissNotice(),
  toggleNavigation: () => toggleNavigation(),
  openBusinessSignup: () => openBusinessSignup(),
  selectBusinessPage: (event,node) => switchBizTab(node.value),
  uploadItemHistory: (event,node) => openItemPricing(Number(node.dataset.arg0),true),
  openItemPricing: (event,node) => openItemPricing(Number(node.dataset.arg0)),
  importItemHistory: () => importItemHistory(),
  trainItemModel: () => trainItemModel(),
  useItemSample: () => useItemSample(),
  loadTrainingData: () => loadTrainingData(),
  downloadTrainingFile: (event,node) => downloadTrainingFile(node.dataset.arg0),
  resetTrainingImport: () => resetTrainingImport(),
  validateTrainingFile: () => importTrainingFile(false),
  importTrainingFile: () => importTrainingFile(true),
  generateTrainingSample: () => generateTrainingSample(),
  saveTrainingSample: () => saveTrainingSample(),
  closeModal: (event, node) => closeModal(node.dataset.arg0),
  toggleCategoryEditor: (event, node) => toggleCategoryEditor(),
  saveFoodCategory: (event, node) => saveFoodCategory(),
  hideCategoryEditor: (event, node) => toggleCategoryEditor(node.dataset.arg0 === 'true'),
  openOfferTimePicker: (event, node) => openOfferTimePicker(node.dataset.arg0),
  closeOfferTimePicker: (event, node) => closeOfferTimePicker(),
  previewFoodImage: (event, node) => previewFoodImage(),
  submitNewListing: (event, node) => submitNewListing(),
  submitCustomerReview: (event, node) => submitCustomerReview(),
  reserveDetail: (event, node) => reserveDetail(event),
  stepDetailQuantity: (event, node) => stepDetailQuantity(Number(node.dataset.arg0)),
  updateDetailQuantity: (event, node) => updateDetailQuantity(),
  clearCart: (event, node) => clearCart(),
  confirmOrder: (event, node) => confirmOrder(),
  openCheckoutModal: (event, node) => openCheckoutModal(),
  markNotificationsRead: (event, node) => markNotificationsRead(),
  verifyPickup: (event, node) => verifyPickup(event),
  rejectOrder: (event, node) => rejectOrder(event),
  changePassword: (event, node) => changePassword(event),
  showScreen: (event, node) => showScreen(node.dataset.arg0),
  removeCartItem: (event, node) => removeCartItem(Number(node.dataset.arg0)),
  stepCartQuantity: (event, node) => stepCartQuantity(Number(node.dataset.arg0), Number(node.dataset.arg1)),
  changeCartQuantity: (event, node) => changeCartQuantity(Number(node.dataset.arg0), node.value),
  toggleFavorite: (event, node) => toggleFavorite(node.dataset.arg0, Number(node.dataset.arg1)),
  openRestaurant: (event, node) => openRestaurant(Number(node.dataset.arg0)),
  setOfferTimeStage: (event, node) => setOfferTimeStage(node.dataset.arg0),
  selectOfferTimePart: (event, node) => selectOfferTimePart(node.dataset.arg0, node.dataset.arg1),
  openListingDetails: (event, node) => openListingDetails(Number(node.dataset.arg0)),
  openCitySettings: (event, node) => openCitySettings(),
  submitDailyQuantity: (event, node) => submitDailyQuantity(Number(node.dataset.arg0)),
  openEditListingModal: (event, node) => openEditListingModal(Number(node.dataset.arg0)),
  deleteListing: (event, node) => deleteListing(Number(node.dataset.arg0)),
  filterCategory: (event, node) => filterCategory(node.dataset.category, node),
  openNotificationOrder: (event, node) => openNotificationOrder(Number(node.dataset.arg0)),
  markNotificationRead: (event, node) => markNotificationRead(Number(node.dataset.arg0)),
  openPickupVerification: (event, node) => openPickupVerification(Number(node.dataset.arg0)),
  changeOrder: (event, node) => changeOrder(Number(node.dataset.arg0), node.dataset.arg1),
  openRejectOrder: (event, node) => openRejectOrder(Number(node.dataset.arg0)),
  openReviewModal: (event, node) => openReviewModal(Number(node.dataset.arg0)),
  deleteReview: (event, node) => deleteReview(Number(node.dataset.arg0)),
  submitReviewReply: (event, node) => submitReviewReply(Number(node.dataset.arg0)),
  showReviewSlide: (event, node) => showReviewSlide(Number(node.dataset.arg0)),
  openNotifications: (event, node) => openNotifications(),
  handleLogout: (event, node) => handleLogout(),
  switchAuthMode: (event, node) => switchAuthMode(node.dataset.arg0, node),
  selectRole: (event, node) => selectRole(node.dataset.arg0, node),
  handleLogin: (event, node) => handleLogin(event),
  openForgotPassword: (event, node) => openForgotPassword(),
  handleSignup: (event, node) => handleSignup(event),
  switchBizTab: (event, node) => switchBizTab(node.dataset.arg0, node),
  openNewListingModal: (event, node) => openNewListingModal(),
  loadDailyAnalytics: (event, node) => loadDailyAnalytics(),
  exportDailyAnalytics: (event, node) => exportDailyAnalytics(),
  saveBusinessProfile: (event, node) => saveBusinessProfile(event),
  openPasswordChange: (event, node) => openPasswordChange(),
  showHomeBanner: (event, node) => showHomeBanner(Number(node.dataset.arg0)),
  toggleHomeBannerPlayback: (event, node) => toggleHomeBannerPlayback(),
  filterListings: (event, node) => filterListings(),
  clearListingFilters: (event, node) => clearListingFilters(),
  refreshMarketplace: (event, node) => refreshMarketplace(),
  loadMyOrders: (event, node) => loadMyOrders(),
  setOrderTab: (event, node) => setOrderTab(node.dataset.arg0),
  saveProfile: (event, node) => saveProfile(event),
  requestPasswordReset: (event, node) => requestPasswordReset(event),
  resetPassword: (event, node) => resetPassword(event),
  renderRestaurantMenu: (event, node) => renderRestaurantMenu(),
  loadRestaurant: (event, node) => loadRestaurant(),
  renderRestaurants: (event, node) => renderRestaurants(),
  loadRestaurants: (event, node) => loadRestaurants(),
  closeBackdrop: (event, node) => { if (event.target === node) closeModal(node.id); },
  dismissCartToast: () => { document.getElementById('cart-toast').hidden = true; },
  previousBanner: () => showHomeBanner(state.homeBannerIndex - 1),
  nextBanner: () => showHomeBanner(state.homeBannerIndex + 1),
  browseFromCart: () => { closeModal('checkout-modal'); return showScreen('customer'); }
};

let installed = false;
export function installActions() {
  if (installed) return;
  installed = true;
  for (const type of ['click', 'input', 'change', 'submit']) {
    document.addEventListener(type, event => {
      const node = event.target.closest?.(`[data-${type}]`);
      if (!node || node.disabled) return;
      const name = node.dataset[type];
      if (!Object.hasOwn(actions, name)) return;
      if (type === 'submit') event.preventDefault();
      Promise.resolve().then(() => actions[name](event, node)).catch(error => {
        console.error('PlateUp action failed:', name, error);
        notify('Could not complete that action. ' + error.message,'error');
      });
    });
  }
}
