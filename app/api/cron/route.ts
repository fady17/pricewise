import { NextResponse } from "next/server";
import {
  getLowestPrice,
  getHighestPrice,
  getAveragePrice,
  getEmailNotifType,
} from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    await connectToDB(); // Ensure await here to properly connect to MongoDB

    const products = await Product.find({});

    if (!products || products.length === 0) {
      throw new Error("No products found in the database");
    }

    // ======================== 1 SCRAPE LATEST PRODUCT DETAILS & UPDATE DB
    const updatedProducts = await Promise.all(
      products.map(async (currentProduct) => {
        try {
          // Scrape product
          const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);

          if (!scrapedProduct) {
            throw new Error(
              `Failed to scrape product data for ${currentProduct.title}`
            );
          }

          const updatedPriceHistory = [
            ...currentProduct.priceHistory,
            { price: scrapedProduct.currentPrice },
          ];

          const updatedProductData = {
            ...scrapedProduct,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };

          // Update product in DB
          const updatedProduct = await Product.findOneAndUpdate(
            { url: currentProduct.url },
            updatedProductData,
            { new: true } // Return the updated document
          );

          // ======================== 2 CHECK EACH PRODUCT'S STATUS & SEND EMAIL ACCORDINGLY
          const emailNotifType = getEmailNotifType(
            scrapedProduct,
            currentProduct
          );

          if (emailNotifType && updatedProduct.users.length > 0) {
            const productInfo = {
              title: updatedProduct.title,
              url: updatedProduct.url,
            };
            // Construct emailContent
            const emailContent = await generateEmailBody(
              productInfo,
              emailNotifType
            );
            // Get array of user emails
            const userEmails = updatedProduct.users.map(
              (user: any) => user.email
            );
            // Send email notification
            await sendEmail(emailContent, userEmails);
          }

          return updatedProduct;
        } catch (error) {
          console.error(
            `Error processing product: ${currentProduct.title}`,
            error
          );
          return null; // Return null for failed updates
        }
      })
    );

    // Filter out null values (failed updates)
    const successfulUpdates = updatedProducts.filter(
      (product) => product !== null
    );

    return NextResponse.json({
      message: "Ok",
      data: successfulUpdates,
    });
  } catch (error: any) {
    console.error("Failed to process products:", error);
    throw new Error(`Failed to get all products: ${error.message}`);
  }
}
