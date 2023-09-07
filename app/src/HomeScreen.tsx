import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import WDILCard from './WDILCard';
import { localStorage } from './LocalStorage';
import { CardType } from './types/CardType';
import { useState } from 'react';

const HomeScreen = () => {
    const fetchCards : () => Array<CardType> = () => {
        return JSON.parse(localStorage.getString('cards') ?? '[]');
    }

    const [cards, setCards] = useState(fetchCards());


    localStorage.addOnValueChangedListener(key => {
        console.log('update')
        if(key === 'cards'){
            setCards(fetchCards());
        }
    });

    

    const renderWDILCards = () => {

        const outWDILCardsJSX : Array<React.JSX> = [];

        cards.forEach(card => {
            const now = new Date();
            let lastDoneDateString = 'never';
            if(card.lastDoneDate){
                const timeDelta = now.getTime() - card.lastDoneDate;
                const timeDeltaInDays = Math.floor(timeDelta / 1000 / 60 / 60 / 24);
                lastDoneDateString = `${timeDeltaInDays} day${timeDeltaInDays != 1 ? 's' : ''} ago`;
            }

            outWDILCardsJSX.push(
                <WDILCard key={card.id} id={card.id} question={card.question} timeSinceEvent={lastDoneDateString} />
            );
        });
        

        return outWDILCardsJSX;
    }
    
    return (
		<View className="flex-1 justify-start bg-[#F5EFB9] py-3 px-2">
            <StatusBar style="auto" />

            <ScrollView>
                { renderWDILCards() }
            </ScrollView>
			
			
			
		</View>
    );
};

export default HomeScreen;