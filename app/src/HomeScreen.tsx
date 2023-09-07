import { StatusBar } from 'expo-status-bar';
import { ScrollView, Text, View } from 'react-native';
import WDILCard from './WDILCard';
import { localStorage } from './LocalStorage';
import { CardType } from './types/CardType';
import { useState, useEffect } from 'react';

const HomeScreen = () => {
    const fetchCards : () => Array<CardType> = () => {
        return JSON.parse(localStorage.getString('cards') ?? '[]');
    }

    const [cards, setCards] = useState(fetchCards());
    const [now, setNow] = useState(new Date());


    localStorage.addOnValueChangedListener(key => {
        if(key === 'cards'){
            setCards(fetchCards());
        }
    });

    //update periodically
    useEffect(() => {
        const timer = setInterval(() => {
            setNow(new Date());
        }, 5000);

        return () => {
            clearInterval(timer);
        };
    }, []);

    

    const renderWDILCards = () => {

        const outWDILCardsJSX : Array<React.JSX.Element> = [];

        cards.forEach(card => {
            //const now = new Date();
            let lastDoneDateString = 'never';
            if(card.lastDoneDate){
                const timeDelta = now.getTime() - card.lastDoneDate;
                const timeDeltaInDays = Math.floor(timeDelta / 1000 / 60 / 60 / 24);
                const timeDeltaInHours = Math.floor(timeDelta / 1000 / 60 / 60);
                const timeDeltaInMinutes = Math.floor(timeDelta / 1000 / 60);
                const timeDeltaInSecounds = Math.floor(timeDelta / 1000);

                lastDoneDateString = '';
                //lastDoneDateString += `${timeDeltaInSecounds % 60} second${timeDeltaInSecounds % 60 != 1 ? 's' : ''} and `;
                //lastDoneDateString += `${timeDeltaInMinutes % 60}m `;
                lastDoneDateString += `${timeDeltaInHours % 24} hour${timeDeltaInHours % 24 != 1 ? 's' : ''} and `;
                lastDoneDateString += `${timeDeltaInDays} day${timeDeltaInDays != 1 ? 's' : ''} ago`;
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